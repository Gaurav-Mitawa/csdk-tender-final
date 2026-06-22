"""Supabase persistence using the EXISTING project tables.

Tables: tenders, tender_artifacts, tender_runs, cycle_events.
Writes use the service key (bypass RLS). Idempotent by tenders.tenderkart_id.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from ..config import settings
from ..supabase_client import service_client

log = logging.getLogger("store")


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_nul(obj):
    """Recursively remove NUL (\\x00) bytes from strings before any Postgres write.

    Postgres text/jsonb columns cannot store \\u0000 — PDF/OCR extraction occasionally
    yields embedded NULs, which otherwise fail the whole row insert with error 22P05
    ("unsupported Unicode escape sequence") and silently drops that tender.
    """
    if isinstance(obj, str):
        return obj.replace("\x00", "") if "\x00" in obj else obj
    if isinstance(obj, dict):
        return {k: _strip_nul(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_strip_nul(v) for v in obj]
    return obj


_MIME = {
    "pdf": "application/pdf", "html": "text/html", "htm": "text/html", "json": "application/json",
    "xls": "application/vnd.ms-excel", "doc": "application/msword",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def ensure_bucket() -> None:
    """Create the (public) storage bucket once; ignore if it already exists."""
    try:
        service_client().storage.create_bucket(settings.storage_bucket, options={"public": True})
        log.info("created storage bucket %s", settings.storage_bucket)
    except Exception:  # noqa: BLE001 — already exists / no-op
        pass


def upload_document(tk_uuid: str, doc_id: str, name: str, content: bytes) -> str | None:
    """Upload the original document to Supabase Storage; return its public URL."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:120]
    path = f"{tk_uuid}/{re.sub(r'[^A-Za-z0-9._-]', '_', doc_id)}_{safe}"
    bucket = service_client().storage.from_(settings.storage_bucket)
    try:
        # upsert=false → on re-runs an already-uploaded file 409s instead of
        # re-transferring the bytes (fast reprocess); we just reuse its URL.
        bucket.upload(
            path=path, file=content,
            file_options={"content-type": _MIME.get(ext, "application/octet-stream"), "upsert": "false"},
        )
    except Exception as exc:  # noqa: BLE001 — duplicate / transient; still return URL
        log.debug("storage upload skipped for %s: %s", name, exc)
    try:
        return bucket.get_public_url(path)
    except Exception:  # noqa: BLE001
        return None


def build_report_message(rows: list, report_url: str | None = None) -> tuple[str, dict]:
    """A natural, professional chat summary of a finished run — grouped, with FULL tender
    titles (no truncation) and plain text (the chat renders plain text, not markdown).
    Shared by the auto end-of-cycle report AND the 'show me the report' tool so both read
    the same to the user."""
    buckets: dict[str, list] = {"ELIGIBLE": [], "PARTIAL": [], "INELIGIBLE": []}
    for r in rows:
        if r.get("verdict") in buckets:
            buckets[r["verdict"]].append(r)
    n = len(rows)
    e, p, x = len(buckets["ELIGIBLE"]), len(buckets["PARTIAL"]), len(buckets["INELIGIBLE"])
    out = [f"I've finished the scan and reviewed {n} tender{'s' if n != 1 else ''} against your profile. "
           f"Here's how they stack up — {e} eligible, {p} partially eligible, and {x} not a fit."]
    sections = (
        ("ELIGIBLE", "ELIGIBLE", "strong fit — worth prioritising for the bid committee"),
        ("PARTIALLY ELIGIBLE", "PARTIAL", "a good fit, with a gap to clear before bidding"),
        ("NOT ELIGIBLE", "INELIGIBLE", "outside scope, or blocked by a hard criterion"),
    )
    for label, key, note in sections:
        items = buckets[key]
        if not items:
            continue
        out.append(f"\n{label} ({len(items)}) — {note}:")
        for i, r in enumerate(items, 1):
            title = (r.get("title") or "Untitled tender").strip()
            sc = r.get("competitiveness_score")
            out.append(f"  {i}. {title}" + (f"  ({sc}/100)" if sc is not None else ""))
    meta = {"report": True, "is_chat_reply": True}
    if report_url:
        out.append("\nThe full analysis — eligibility checks, gaps to address, pre-bid queries and the "
                   "exact source pages for every figure — is in the PDF report below.")
        meta["combined_url"] = report_url
        meta["combined_name"] = "Tender Intelligence Report"
    return "\n".join(out), meta


def persist_scheduled_report(text: str, meta: dict | None, run_id: str) -> None:
    """Save a scheduled run's report into chat history.

    A manual run's report is persisted by the browser (it copies the live cycle_event
    into the active chat session). A scheduled run has no browser watching, so we write
    it here: into a rolling "Automated scans" session owned by the account that uses the
    app (the owner of the most recently active chat session). Best-effort — never raises.
    """
    try:
        c = service_client()
        sess = (c.table("chat_sessions").select("id,user_id")
                .order("updated_at", desc=True).limit(1).execute()).data
        if not sess:
            return  # no account/session yet — nothing to attach to (cycle_events still recorded)
        uid = sess[0]["user_id"]
        existing = (c.table("chat_sessions").select("id")
                    .eq("user_id", uid).eq("title", "Automated scans").limit(1).execute()).data
        if existing:
            sid = existing[0]["id"]
        else:
            ins = c.table("chat_sessions").insert(
                {"user_id": uid, "title": "Automated scans",
                 "created_at": _utcnow(), "updated_at": _utcnow()}).execute()
            sid = ins.data[0]["id"]
        cycle_id = f"sched-{run_id}"
        dup = (c.table("chat_messages").select("id")
               .eq("session_id", sid).eq("cycle_id", cycle_id).limit(1).execute()).data
        if dup:
            return
        c.table("chat_messages").insert(_strip_nul({
            "session_id": sid, "role": "agent", "content": text,
            "type": "text", "meta": meta, "cycle_id": cycle_id,
        })).execute()
        c.table("chat_sessions").update({"updated_at": _utcnow()}).eq("id", sid).execute()
    except Exception as exc:  # noqa: BLE001 — persistence must never break a run
        log.warning("scheduled report persist failed: %s", exc)


def upload_report(run_id: str, content: bytes) -> str | None:
    """Upload the generated PDF report to Storage (upsert) and return its public URL."""
    try:
        ensure_bucket()
        bucket = service_client().storage.from_(settings.storage_bucket)
        path = f"reports/tender_report_{run_id[:8]}.pdf"
        try:
            bucket.upload(path=path, file=content,
                          file_options={"content-type": "application/pdf", "upsert": "true"})
        except Exception as exc:  # noqa: BLE001 — re-run overwrite / transient; still return URL
            log.debug("report upload note for %s: %s", run_id[:8], exc)
        return bucket.get_public_url(path)
    except Exception as exc:  # noqa: BLE001
        log.warning("report upload failed: %s", exc)
        return None


# ── cycle_events (live narration) ────────────────────────────────────────────
def emit(run_id: str | None, level: str, message: str, meta: dict | None = None) -> None:
    try:
        service_client().table("cycle_events").insert(
            _strip_nul({"run_id": run_id, "level": level, "message": message, "meta": meta})
        ).execute()
    except Exception as exc:  # noqa: BLE001 — narration must never break a run
        log.warning("cycle_events insert failed: %s", exc)


# ── tender_runs ──────────────────────────────────────────────────────────────
def create_run(triggered_by: str) -> str:
    res = service_client().table("tender_runs").insert(
        {"status": "running", "triggered_by": triggered_by}
    ).execute()
    return res.data[0]["id"]


def update_run(run_id: str, **fields) -> None:
    try:
        service_client().table("tender_runs").update(fields).eq("id", run_id).execute()
    except Exception as exc:  # noqa: BLE001
        log.warning("tender_runs update failed: %s", exc)


def latest_run() -> dict:
    res = (
        service_client().table("tender_runs")
        .select("*").order("started_at", desc=True).limit(1).execute()
    )
    return res.data[0] if res.data else {}


def is_running() -> bool:
    res = service_client().table("tender_runs").select("id").eq("status", "running").limit(1).execute()
    return bool(res.data)


# ── tenders ──────────────────────────────────────────────────────────────────
def tender_db_id(tenderkart_id: str) -> str | None:
    res = (
        service_client().table("tenders")
        .select("id").eq("tenderkart_id", tenderkart_id).limit(1).execute()
    )
    return res.data[0]["id"] if res.data else None


def _write_tender(row: dict, existing: str | None) -> str:
    row = _strip_nul(row)
    if existing:
        service_client().table("tenders").update(row).eq("id", existing).execute()
        return existing
    res = service_client().table("tenders").insert(row).execute()
    # PostgREST returns the inserted row by default (service key bypasses RLS); guard the
    # rare empty-representation case so a successful insert doesn't crash on data[0].
    return res.data[0]["id"] if res.data else (tender_db_id(row.get("tenderkart_id")) or "")


def upsert_tender(row: dict, tenderkart_id: str) -> str:
    """Insert or update by tenderkart_id (no unique constraint needed). Returns row id.

    If a legacy CHECK constraint rejects a value, retry once with the enum-ish
    fields sanitized so the tender still persists.
    """
    from postgrest.exceptions import APIError

    existing = tender_db_id(tenderkart_id)
    try:
        return _write_tender(row, existing)
    except APIError as exc:
        if getattr(exc, "code", None) == "23514":  # check_violation (e.g. risk_level)
            log.warning("CHECK violation (%s) — retrying with risk_level=None (verdict kept)", exc.message)
            row = {**row, "risk_level": None}  # only sanitize the offending field
            return _write_tender(row, existing)
        raise


# ── tender_artifacts (documents) ─────────────────────────────────────────────
def replace_artifacts(tender_id: str, artifacts: list[dict]) -> None:
    service_client().table("tender_artifacts").delete().eq("tender_id", tender_id).execute()
    if not artifacts:
        return
    for a in artifacts:
        a["tender_id"] = tender_id
    service_client().table("tender_artifacts").insert(_strip_nul(artifacts)).execute()
