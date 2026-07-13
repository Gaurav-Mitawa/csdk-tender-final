"""Ingest orchestrator: TenderKart -> extract -> RULES -> (narrate) -> Supabase.

Fills the EXISTING `tenders` table (TenderKart fields + regex/gpt-4o-mini extraction
+ deterministic RULES verdict) and `tender_artifacts` (one row per document).
Narrates live to `cycle_events`. Idempotent by tenderkart_id.

Run in background via /runs/trigger, or as CLI:  python -m app.pipeline.ingest
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from ..config import settings
from ..llm_extract import hybrid_extract
from ..narrative import generate_narrative
from ..profile import load_profile
from ..qualify import qualify, scope_check, title_excluded
from ..titles import _norm, clean_display_title
from . import store
from .extract import ExtractResult, extract, vision_recover
from .tenderkart import TenderKart

log = logging.getLogger("ingest")

_lock = threading.Lock()
_active = False
_stop = threading.Event()   # set -> the running cycle halts after the current tender
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def request_stop() -> bool:
    """Stop the running cycle. If a live thread is processing, signal it to halt
    after the current tender; otherwise clear any stale 'running' lock in the DB.
    Returns True if something was running."""
    if _active:
        _stop.set()   # live cycle thread will halt + mark the run stopped
        return True
    if store.is_running():
        # No live cycle in this process — the lock is stale; clear it directly and
        # emit a done-progress so the live tracker hides (and stays hidden on reload).
        try:
            from ..supabase_client import service_client
            rows = service_client().table("tender_runs").select("id").eq("status", "running").execute().data or []
            service_client().table("tender_runs").update(
                {"status": "failed", "completed_at": _now()}
            ).eq("status", "running").execute()
            for r in rows:
                store.emit(r["id"], "warn", "🛑 Scan stopped — background process halted.",
                           meta={"progress": {"pct": 100, "label": "Stopped", "done": True}})
        except Exception as exc:  # noqa: BLE001
            log.warning("stale-lock clear failed: %s", exc)
        return True
    return False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _date_part(iso: str | None) -> str | None:
    if not iso:
        return None
    return str(iso)[:10] if _DATE_RE.match(str(iso)[:10]) else None


def _valid_date(s) -> str | None:
    return s if isinstance(s, str) and _DATE_RE.match(s) else None


# ── dedup / corrigendum identity ──────────────────────────────────────────────
def _identity_key(detail: dict) -> str | None:
    """Stable identity for a real-world tender: normalized title + authority + reference.

    A re-list (a NEW TenderKart uuid for the same tender) collides on this key, so it is
    caught as a duplicate/corrigendum. Genuinely different tenders that merely share a
    generic title stay separate because the reference number is part of the key.
    """
    title = _norm(detail.get("title"))
    org = _norm(detail.get("organisation"))
    ref = _norm(detail.get("tender_reference_number"))
    if not title and not ref:
        return None
    return f"{title}|{org}|{ref}"


def _fmt_inr(v) -> str:
    try:
        return f"₹{float(v) / 1e7:.2f} Cr"
    except Exception:  # noqa: BLE001
        return str(v)


def _corrigendum_changes(old: dict, detail: dict) -> list[dict]:
    """What changed between a stored tender and its re-listed version.

    Empty list => nothing material changed => an exact duplicate (skip it). A non-empty
    list => a corrigendum: the same tender with an amended deadline / value / EMD."""
    changes: list[dict] = []
    new_close = _date_part(detail.get("closing_at"))
    old_close = (str(old.get("closing_date") or "")[:10]) or None
    if new_close and old_close and new_close != old_close:
        changes.append({"field": "Submission deadline", "old": old_close, "new": new_close})
    try:
        nv, ov = detail.get("tender_value"), old.get("estimated_value")
        if nv and ov and round(float(nv)) != round(float(ov)):
            changes.append({"field": "Estimated value", "old": _fmt_inr(ov), "new": _fmt_inr(nv)})
    except Exception:  # noqa: BLE001
        pass
    try:
        ne, oe = detail.get("emd_fee"), old.get("emd_amount")
        if ne and oe and round(float(ne)) != round(float(oe)):
            changes.append({"field": "EMD", "old": _fmt_inr(oe), "new": _fmt_inr(ne)})
    except Exception:  # noqa: BLE001
        pass
    return changes


# ── public API used by the router ─────────────────────────────────────────────
def start_run(triggered_by: str = "manual", filter_ids: list[str] | None = None,
              limit: int | None = None, reprocess: bool | None = None,
              exclude_keywords: list[str] | None = None,
              chat_session_id: str | None = None) -> str | None:
    global _active
    with _lock:
        if _active or store.is_running():
            return None
        _active = True
    try:
        run_id = store.create_run(triggered_by)
    except Exception:
        with _lock:
            _active = False
        raise
    threading.Thread(target=_run_thread,
                     args=(run_id, filter_ids, limit, reprocess, exclude_keywords, triggered_by, chat_session_id),
                     daemon=True).start()
    return run_id


def latest_run_status() -> dict:
    return store.latest_run()


def _run_thread(run_id: str, filter_ids: list[str] | None,
                limit: int | None = None, reprocess: bool | None = None,
                exclude_keywords: list[str] | None = None,
                triggered_by: str = "manual", chat_session_id: str | None = None) -> None:
    global _active
    try:
        run_cycle(run_id, filter_ids, limit, reprocess, exclude_keywords, triggered_by, chat_session_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("cycle crashed")
        store.emit(run_id, "error", f"Cycle failed: {exc}")
        store.update_run(run_id, status="failed", completed_at=_now())
    finally:
        with _lock:
            _active = False


# ── the cycle ─────────────────────────────────────────────────────────────────
def run_cycle(run_id: str, filter_ids: list[str] | None = None,
              limit: int | None = None, reprocess: bool | None = None,
              exclude_keywords: list[str] | None = None,
              triggered_by: str = "manual", chat_session_id: str | None = None) -> None:
    # Each run processes up to `cap` NEW tenders. Anything beyond the cap is COUNTED (not
    # processed) and offered to the user as a "reply yes to process the next batch" prompt.
    cap = int(limit) if limit else settings.max_tenders_per_run
    explicit = limit is not None   # chat 'find N' -> show X/N; manual full scan -> show running count
    reproc = settings.reprocess_existing if reprocess is None else bool(reprocess)
    # Rolling window: fetch tenders updated in the last N days (stays current, no hardcoded date).
    if settings.sync_window_days:
        sync_after = (datetime.now(timezone.utc) - timedelta(days=settings.sync_window_days)).strftime("%Y-%m-%dT00:00:00Z")
    else:
        sync_after = settings.sync_updated_after
    _stop.clear()
    tk = TenderKart()
    # Scan-start tick so the live tracker + Stop button appear the moment the button is clicked.
    store.emit(run_id, "info", "Scanning TenderKart…",
               meta={"progress": {"processed": 0, "total": (cap if explicit else None), "label": "Scanning TenderKart…", "pct": 0}})
    if settings.upload_documents:
        store.ensure_bucket()
    prof = load_profile()  # editable RULES config (financials, scope keywords)
    # Per-scan exclusions (e.g. chat: "exclude light, show, security"). Added to the profile's
    # exclude list so the cost-gate + qualifier drop them as EXCLUDED (a strong title match
    # overrides any incidental scope hit) — they never reach the report.
    if exclude_keywords:
        _extra = [str(e).strip().lower() for e in exclude_keywords if str(e).strip()]
        if _extra:
            prof.exclude_keywords = list(prof.exclude_keywords or []) + _extra
            store.emit(run_id, "info", f"Excluding keywords: {', '.join(_extra)}")

    filters = tk.list_filters()
    if filter_ids:
        wanted = set(filter_ids)
        filters = [f for f in filters if f["id"] in wanted]
    store.update_run(run_id, sites_total=len(filters))
    store.emit(run_id, "info", f"{len(filters)} filter(s) to scan since {sync_after[:10]}.")

    found = qualified = sites_done = 0
    remaining_new = 0   # NEW tenders beyond the cap — counted (not processed), offered via 'reply yes'
    stopped = False
    seen: set[str] = set()   # tk_uuids handled this run — TenderKart returns the same tender
    #                          under multiple category filters; handle each ONCE (no dup count).

    def _tick(n: int) -> None:
        if explicit:   # chat 'find N' → fraction X/N
            lbl = f"Processing tenders {n}/{cap}"
            m = {"pct": round(n / max(cap, 1) * 88), "label": lbl, "processed": n, "total": cap}
        else:          # 'Run agent now' → running count (total unknown ~100-150)
            lbl = f"Processed {n} tender{'s' if n != 1 else ''}"
            m = {"pct": None, "label": lbl, "processed": n, "total": None}
        store.emit(run_id, "info", lbl, meta={"progress": m})

    for f in filters:
        if _stop.is_set():
            stopped = True
            break
        fid = f["id"]
        fname = f.get("name") or fid
        store.emit(run_id, "info", f"Scanning filter: {fname}")
        f_count = 0
        try:
            for t in tk.iter_filter_tenders(fid, sync_after):
                if _stop.is_set():
                    stopped = True
                    break
                tk_uuid = t["id"]
                if tk_uuid in seen:
                    continue   # same tender under another filter — already handled this run
                seen.add(tk_uuid)
                capped = cap is not None and found >= cap
                # Below the ₹-floor (value disclosed) → reject outright, do NOT store.
                _val_cr = (t.get("tender_value") or 0) / 1e7
                if _val_cr and _val_cr < prof.min_tender_value_cr:
                    if not capped:
                        store.emit(run_id, "info", f"Skipped (below ₹{prof.min_tender_value_cr} Cr floor): {(t.get('title') or '')[:40]}")
                    continue
                if not reproc and store.tender_db_id(tk_uuid):
                    continue  # already processed in a previous run — skip, so each scan
                    #            surfaces only genuinely NEW tenders (no repeats)
                if capped:
                    # Past the per-run cap: a genuinely NEW, processable tender. Count it so we
                    # can offer "reply yes to process the next batch" — but do NOT process it now
                    # (keeps each run's memory + runtime bounded; this is what fixed the OOM).
                    remaining_new += 1
                    continue
                # Per-tender hard cap: run in a worker thread; if it exceeds the timeout,
                # skip it and move on (the slow thread is abandoned, not awaited).
                from concurrent.futures import ThreadPoolExecutor
                from concurrent.futures import TimeoutError as _FTimeout
                _ex = ThreadPoolExecutor(max_workers=1)
                try:
                    verdict = _ex.submit(_ingest_tender, tk, tk_uuid, fname, run_id, prof).result(
                        timeout=settings.tender_timeout_sec)
                    _ex.shutdown(wait=False)
                except _FTimeout:
                    _ex.shutdown(wait=False, cancel_futures=True)
                    log.warning("tender %s timed out (> %ss) — skipping", tk_uuid, settings.tender_timeout_sec)
                    store.emit(run_id, "warn",
                               f"Skipped a tender ({tk_uuid[:8]}) — exceeded {settings.tender_timeout_sec // 60}-min cap.")
                    continue
                except Exception as exc:  # noqa: BLE001 — one tender must not abort the filter
                    _ex.shutdown(wait=False)
                    log.warning("tender %s failed: %s", tk_uuid, exc)
                    store.emit(run_id, "warn", f"Skipped a tender ({tk_uuid[:8]}): {exc}")
                    continue
                if verdict == "DUPLICATE":
                    continue  # exact re-list — already stored & reported; don't count/tick
                if verdict == "DOCS_PENDING":
                    continue  # documents not ready (temporary) — NOT stored; next scan retries
                found += 1
                f_count += 1
                if _stop.is_set():   # stopped mid-tender → don't emit a stray progress tick
                    stopped = True
                    break
                _tick(found)
                if verdict in ("ELIGIBLE", "PARTIAL"):
                    qualified += 1
            sites_done += 1
            store.emit(run_id, "success", f"{fname}: {f_count} tender(s) processed.")
        except Exception as exc:  # noqa: BLE001 — one bad filter shouldn't kill the run
            log.exception("filter %s failed", fname)
            store.emit(run_id, "error", f"{fname} failed: {exc}")
        store.update_run(
            run_id, sites_succeeded=sites_done, sites_failed=len(filters) - sites_done,
            tenders_found=found, tenders_qualified=qualified,
        )
        if stopped:
            break

    if stopped:
        store.emit(run_id, "warn", "🛑 Scan stopped — background process halted.",
                   meta={"progress": {"pct": 100, "label": "Stopped", "done": True}})
        store.update_run(run_id, status="failed", completed_at=_now(),
                         tenders_found=found, tenders_qualified=qualified, sites_succeeded=sites_done)
        return

    # NOTE: no re-link. Each tender belongs to the ONE run that first processed it and
    # appears in exactly that run's report — never re-processed, never duplicated across
    # reports. (This also keeps each report small, which is what fixed the PDF OOM.)

    # Backfill any missing narratives for THIS run's tenders (e.g. a Claude call that failed
    # mid-run) so the report is complete. Bounded so it can't run away.
    try:
        _regen_missing_narratives(run_id, prof)
    except Exception as exc:  # noqa: BLE001
        log.warning("narrative backfill failed: %s", exc)

    # Final phase — generate the PDF report, upload it, and post it (with download link) to the chat.
    store.emit(run_id, "info", "Generating report…",
               meta={"progress": {"pct": 92, "label": "Generating report…"}})
    report_url = None
    try:
        import os
        import tempfile

        from ..report_pdf import build_pdf
        out = os.path.join(tempfile.gettempdir(), f"tender_report_{run_id[:8]}.pdf")
        build_pdf(run_id, out_path=out)   # WeasyPrint, with a reportlab fallback on Windows
        with open(out, "rb") as fh:
            report_url = store.upload_report(run_id, fh.read())
    except Exception as exc:  # noqa: BLE001
        log.warning("report generation/upload failed: %s", exc)

    # In-chat report — verdict breakdown + the PDF download link (rendered in the dashboard chat).
    try:
        from ..supabase_client import service_client
        rows = (service_client().table("tenders")
                .select("title,verdict,competitiveness_score").eq("run_id", run_id)
                .neq("verdict", "EXCLUDED").order("competitiveness_score", desc=True).execute().data or [])
        text, meta = store.build_report_message(rows, report_url)
        if remaining_new > 0:
            # Per-run limit reached and MORE new tenders remain — offer the next batch.
            text += (f"\n\n⏳ {remaining_new} more new tender{'s' if remaining_new != 1 else ''} "
                     f"are still waiting (this run processed the first {found}, the per-run limit). "
                     f"Reply “yes” and I'll process the next batch of up to {cap}.")
            meta["remaining_new"] = remaining_new
        store.emit(run_id, "success", text, meta=meta)
        # Persist the report to chat for EVERY run (not just scheduled). The browser only
        # copies it when it's watching at finish-time; long runs / closed tabs lost it.
        # Backend persistence makes it survive on reload regardless. Targets the session
        # the run was triggered from.
        store.persist_report(text, meta, run_id, session_id=chat_session_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("report summary failed: %s", exc)

    store.update_run(
        run_id, status="completed", completed_at=_now(),
        tenders_found=found, tenders_qualified=qualified, sites_succeeded=sites_done,
    )
    store.emit(run_id, "success", f"Cycle complete — {found} tenders processed, {qualified} qualified.",
               meta={"progress": {"pct": 100, "label": "Done", "done": True}})


def _regen_missing_narratives(run_id: str, profile, cap: int = 60) -> None:
    """Regenerate narratives for tenders in this run that are missing one (e.g. an earlier
    Claude failure) so the report is complete. No re-extraction — narrative only. Bounded."""
    if not settings.anthropic_api_key:
        return
    from ..supabase_client import service_client
    rows = (service_client().table("tenders").select("*")
            .eq("run_id", run_id).neq("verdict", "EXCLUDED").limit(1000).execute().data or [])
    done = 0
    for row in rows:
        if done >= cap:
            log.info("narrative backfill hit cap (%d); remaining will fill on the next run", cap)
            break
        verdict = (row.get("verdict") or "").upper()
        if verdict in ("ELIGIBLE", "PARTIAL"):
            has = (row.get("narrative_fit") or "").strip()
        else:  # INELIGIBLE
            has = (row.get("business_logic_explanation") or "").strip() or (row.get("key_business_insight") or "").strip()
        if has:
            continue
        try:
            upd = generate_narrative(row, profile)
        except Exception as exc:  # noqa: BLE001
            log.warning("regen narrative failed for %s: %s", str(row.get("id"))[:8], exc)
            continue
        if not upd:
            continue
        # text[] columns: wrap a bare string so the array insert doesn't fail (same guard
        # the main ingest path applies after narration).
        for _k in ("key_deliverables", "eligibility_conditions", "documents_required", "gaps_to_address"):
            _v = upd.get(_k)
            if isinstance(_v, str):
                upd[_k] = [_v.strip()] if _v.strip() else None
        try:
            service_client().table("tenders").update(upd).eq("id", row["id"]).execute()
            done += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("regen narrative update failed for %s: %s", str(row.get("id"))[:8], exc)
    if done:
        log.info("regenerated %d missing narrative(s) for run %s", done, run_id[:8])


def _transient_download_error(exc: Exception | None) -> bool:
    """True for a MOMENTARY document-download failure — the file exists but wasn't
    downloadable right now, so retrying later will work. Per the TenderKart API docs a
    document that isn't ready yet returns HTTP 409 ("Document is not available yet. Retry
    later."); 429 is rate-limit and 5xx is a server error — all temporary. A 404
    (permanently missing) is NOT transient. TenderKart exposes a tender before its
    attachments finish syncing, so a fresh tender's docs can 409 for a short while."""
    if exc is None:
        return False
    import requests

    from .tenderkart import RateLimited
    if isinstance(exc, (requests.Timeout, requests.ConnectionError, RateLimited)):
        return True
    code = getattr(getattr(exc, "response", None), "status_code", None)
    return isinstance(code, int) and (code in (409, 429) or 500 <= code < 600)


def _ingest_tender(tk: TenderKart, tk_uuid: str, filter_name: str, run_id: str, profile) -> str:
    detail = tk.get_tender(tk_uuid)

    # DEDUP / CORRIGENDUM — the same real tender is often re-listed by TenderKart under a
    # NEW uuid (a new closing date / minor amendment). The uuid skip in run_cycle can't
    # catch that, so match on a content identity (title+authority+reference). If we already
    # stored this tender under a different uuid:
    #   • nothing material changed  -> exact duplicate: skip (saves tokens, no repeat)
    #   • deadline/value/EMD changed -> CORRIGENDUM: update the SAME row in place + record
    #     what changed, so it appears once (flagged) with its changes — not as a new copy.
    identity = _identity_key(detail)
    existing = store.tender_by_identity(identity) if identity else None
    corr_changes: list[dict] = []
    corr_target_id: str | None = None
    if existing and existing.get("tenderkart_id") != tk_uuid:
        corr_changes = _corrigendum_changes(existing, detail)
        if not corr_changes:
            store.emit(run_id, "info",
                       f"Skipped duplicate (already reported): {(detail.get('title') or '')[:42]}")
            return "DUPLICATE"
        corr_target_id = existing.get("id")
        store.emit(run_id, "info",
                   f"Corrigendum — updating existing tender: {(detail.get('title') or '')[:42]}")

    # COST GATE — cheap scope check on the summary; if clearly out of scope, skip
    # the expensive document download + extraction + LLM entirely.
    pre_text = " ".join(str(detail.get(k) or "") for k in ("title", "tender_category", "product_category", "organisation"))
    pre_excluded = scope_check(pre_text, profile)["excluded"] or title_excluded(str(detail.get("title") or ""), profile)

    # STEP 1 — "Ctrl+A": copy all selectable text from every document.
    extracted, hashes = [], []
    transient_dl_fail = 0   # docs that failed to download with a TEMPORARY error (not ready yet)
    if pre_excluded:
        store.emit(run_id, "info", f"Out of scope — skipped extraction: {(detail.get('title') or '')[:42]}")
    for doc in (detail.get("documents", []) if not pre_excluded else []):
        doc_id = doc.get("id")
        name = doc.get("name", doc_id or "document")
        content = None
        last_exc: Exception | None = None
        for _attempt in range(2):   # one quick in-run retry — the second try often succeeds
            try:
                content = tk.download_document(doc_id)
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if _transient_download_error(exc) and _attempt == 0:
                    time.sleep(2)
                    continue
                break
        if content is None:
            if _transient_download_error(last_exc):
                transient_dl_fail += 1
                store.emit(run_id, "info", f"Document not ready yet (temporary): {name[:40]}")
            else:  # 404 / permanent — the file genuinely isn't there; process with the rest
                log.warning("doc download %s failed (permanent): %s", name, last_exc)
            continue
        url = store.upload_document(tk_uuid, doc_id, name, content) if settings.upload_documents else None
        if len(content) > settings.max_extract_doc_mb * 1024 * 1024:
            # Parsing a huge PDF is CPU-bound and can't be interrupted by the per-tender
            # watchdog on a shrunk-CPU host (the cause of "stuck after N tenders"). Keep the
            # doc as a downloadable source link, but don't parse it.
            store.emit(run_id, "info",
                       f"Skipped parsing oversized doc ({len(content) // (1024 * 1024)} MB): {name[:40]}")
            continue
        # Parse selectable text (no OCR here). A corrupt/unreadable file from TenderKart
        # must skip ITS text only — never abort this tender or the run. We still keep the
        # original as a downloadable link (it may open fine for a human).
        try:
            res = extract(name, content)
        except Exception as exc:  # noqa: BLE001 — belt-and-suspenders: extract() shouldn't raise
            log.warning("doc extract %s failed — skipping: %s", name, exc)
            res = ExtractResult(fmt="unreadable", markdown="", error=str(exc))
        if res.error:
            store.emit(run_id, "info", f"Skipped unreadable document: {name[:40]}")
            res.markdown, res.pages = "", []   # drop any partial/garbage text
            if not res.content_hash:
                res.content_hash = hashlib.sha256(content).hexdigest()
        extracted.append({"doc": doc, "name": name, "content": content, "res": res, "url": url})
        hashes.append(res.content_hash)

    # DOCUMENT-READINESS GUARD — if ANY of this tender's documents failed to download with a
    # TEMPORARY error (even if some succeeded), the tender's document set is incomplete right
    # now. Do NOT judge or store it on a partial set — a missing RFP/BOQ could make a real
    # tender look out-of-scope and silently drop it. Skip WITHOUT storing so the next scheduled
    # scan re-fetches it once every document is downloadable (usually within a day). 404s
    # (permanently missing) are NOT transient, so genuinely doc-light tenders still process.
    if not pre_excluded and transient_dl_fail:
        store.emit(run_id, "warn",
                   f"Documents not ready yet ({transient_dl_fail} temporary fail) — will retry "
                   f"next scan: {(detail.get('title') or '')[:42]}")
        return "DOCS_PENDING"

    def _docname(name: str) -> str:
        # The scraped HTML detail page is the TenderKart listing, not a tender document —
        # give it a clean label so page refs read "Tender Listing", never "details.html".
        return "Tender Listing" if str(name or "").lower().endswith((".html", ".htm")) else name

    combined = []
    for e in extracted:
        pages = e["res"].pages or [e["res"].markdown]
        for pno, ptext in enumerate(pages, 1):
            if ptext and ptext.strip():
                combined.append(f"\n\n=== DOCUMENT: {_docname(e['name'])} | PAGE {pno} ===\n{ptext}")
    combined_md = "\n".join(combined).strip()

    # STEP 2 — only if the text copy came back essentially empty, call gpt-4o-mini vision.
    vision_text: dict[str, str] = {}
    if len(combined_md) < 300 and settings.enable_vision_fallback:
        store.emit(run_id, "info", "Text copy empty — falling back to gpt-4o-mini vision…")
        for e in extracted:
            vmd = vision_recover(e["name"], e["content"])
            if vmd:
                vision_text[e["doc"].get("id")] = vmd
                combined.append(f"\n\n=== DOCUMENT: {_docname(e['name'])} (vision) ===\n{vmd}")
        combined_md = "\n".join(combined).strip()

    artifacts, docs_meta = [], []
    for e in extracted:
        did = e["doc"].get("id")
        text = vision_text.get(did) or e["res"].markdown
        artifacts.append(
            {"file_name": e["name"], "file_type": e["res"].fmt, "storage_url": e["url"], "extracted_text": text}
        )
        docs_meta.append(
            {"doc_id": did, "name": e["name"], "kind": e["doc"].get("document_type"),
             "format": e["res"].fmt, "pages": len(e["res"].pages or [e["res"].markdown]),
             "storage_url": e["url"], "public_url": e["url"], "ocr_used": did in vision_text}
        )

    # 2) EXTRACT — hybrid: Python/regex (free) first, gpt-4o-mini ONLY for missed fields.
    ex: dict = {}
    ex_log: dict = {}
    if combined_md and not pre_excluded:
        # Scope-fit context comes entirely from THIS customer's Supabase profile (generic,
        # multi-tenant — nothing hardcoded). The LLM judges whether the tender truly fits.
        _inc = (profile.include_keywords or []) or [
            kw for kws in (profile.scope_keywords or {}).values() for kw in (kws or [])
        ]
        scope_ctx = {
            "company": getattr(profile, "company_name", "") or "",
            "scope_description": getattr(profile, "scope_description", "") or "",
            "include": _inc,
            "exclude": profile.exclude_keywords or [],
        }
        ex, ex_log = hybrid_extract(combined_md, scope_ctx)

    content_hash = hashlib.sha256(
        (json.dumps(detail, sort_keys=True, default=str) + "".join(hashes)).encode()
    ).hexdigest()

    # Issue 2 — TenderKart sometimes puts the reference/bid CODE in `title`. Prefer the real
    # "Name of Work" the extractor read out of the document (document-extracted, not invented);
    # fall back to the scope summary, then the raw code as a last resort.
    display_title = clean_display_title(
        detail.get("title"),
        reference=detail.get("tender_reference_number"),
        extracted_title=(ex.get("tender_title") or ex.get("name_of_work")),
        scope_summary=ex.get("scope_summary"),
    )

    # 3) build the tenders row. TK + Py + EXTRACT fields now; verdict/score/risk
    #    (RULES) and narrative (Claude) layers are filled later.
    row = {
        "run_id": run_id,
        "tenderkart_id": tk_uuid,
        "content_hash": content_hash,
        "content_identity": identity,
        "is_corrigendum": bool(corr_changes),
        "corrigendum_changes": corr_changes or None,
        "portal_name": detail.get("portal_name") or "tenderkart",
        "title": display_title or "(untitled)",
        "reference_number": detail.get("tender_reference_number"),
        "issuing_authority": detail.get("organisation"),
        "issuing_authority_location": ex.get("issuing_authority_location"),
        "authority_contact": ex.get("authority_contact"),
        # TenderKart value first; if it didn't disclose one, use the value the
        # extractor pulled from the BOQ/RFP (regex → gpt-4o-mini), Cr → INR.
        "estimated_value": detail.get("tender_value") or (round(ex["estimated_value_cr"] * 1e7) if ex.get("estimated_value_cr") else None),
        "emd_amount": detail.get("emd_fee"),
        "emd_currency": "INR",
        "pbg_percent": ex.get("pbg_percent"),
        "min_turnover_cr": ex.get("min_turnover_cr"),
        "min_networth_cr": ex.get("min_networth_cr"),
        "pre_bid_date": _valid_date(ex.get("pre_bid_date")),
        "opening_date": _valid_date(ex.get("opening_date")),
        "closing_date": _date_part(detail.get("closing_at")),
        "published_at": detail.get("published_at"),
        "tender_type": ex.get("award_method"),       # EXTRACT (L1/QCBS/…)
        "tender_mode": detail.get("tender_type"),     # TK (Open/Limited)
        "procurement_model": ex.get("procurement_model"),    # EPC / O&M / PPP …
        "commercial_model": ex.get("commercial_model"),      # who pays whom
        "scope_summary": ex.get("scope_summary"),
        "location_of_execution": ex.get("location_of_execution"),
        "project_duration": ex.get("project_duration"),
        "source_url": f"tenderkart://{detail.get('portal_name')}/{detail.get('tender_id')}",
        "raw_text": combined_md[:200000],
        "verdict": "PENDING",                         # RULES layer (later)
        "matched_keyword": filter_name,
        "matched_bucket": filter_name,
        "matched_categories": [c for c in (detail.get("tender_category"), detail.get("product_category")) if c],
        "key_deliverables": ex.get("key_deliverables"),
        "eligibility_conditions": ex.get("eligibility_conditions"),
        "unusual_clauses": ex.get("unusual_clauses"),
        "penalty_clauses": ex.get("penalty_clauses"),
        "sow_page_refs": ex.get("sow_page_refs"),
        "documents_required": ex.get("documents_required"),
        "bidding_capacity": ex.get("bidding_capacity"),
        "multiplier_factor": ex.get("multiplier_factor"),
        "downloaded_docs": docs_meta,
        "extracted_data": {
            "all_fields": ex.get("all_fields"),
            "key_dates": ex.get("key_dates"),
            "page_refs": ex.get("page_refs"),
            "scope_fit": ex.get("scope_fit"),   # LLM scope/eligibility judgment (drives the verdict gate)
            "extras": ex.get("extras"),
            "tender_type_confidence": ex.get("tender_type_confidence"),
            "tender_type_basis": ex.get("tender_type_basis"),
            "commercial_basis": ex.get("commercial_basis"),
            "similar_work_pct": ex.get("similar_work_pct"),
            "similar_work_required_cr": ex.get("similar_work_required_cr"),
            "tenderkart": detail,
        },
        "extraction_log": ex_log,
        # narrative columns reset to null on every run; the narrate step fills the
        # relevant ones — prevents stale prose when a verdict changes.
        "narrative_fit": None, "key_business_insight": None, "strategic_fit_basis": None,
        "compliance_basis": None, "risk_layperson_explanation": None, "pre_bid_queries": None,
        "disqualification_triggers": None, "business_logic_explanation": None,
    }
    # 4) RULES — deterministic verdict / score / risk (NO LLM)
    row.update(qualify(row, profile))

    # 5) NARRATE — Claude writes the report prose (skip clearly out-of-scope EXCLUDED)
    if settings.anthropic_api_key and row.get("verdict") != "EXCLUDED":
        try:
            row.update(generate_narrative(row, profile))
        except Exception as exc:  # noqa: BLE001
            log.warning("narrative failed: %s", exc)

    # text[] columns: gpt-5-mini / Claude occasionally return a bare string where the schema
    # asks for a list (e.g. a single document, or one gap). Wrap it so the Postgres array
    # insert doesn't fail outright (the 23514 retry only sanitises risk_level) and the report
    # doesn't iterate the string character-by-character.
    for _k in ("key_deliverables", "eligibility_conditions", "documents_required", "gaps_to_address"):
        _v = row.get(_k)
        if isinstance(_v, str):
            row[_k] = [_v.strip()] if _v.strip() else None

    # For a corrigendum, update the SAME existing row (found by identity) so the tender
    # keeps one copy; otherwise upsert by tenderkart_id as usual.
    tender_id = store.upsert_tender(row, tk_uuid, existing_id=corr_target_id)
    store.replace_artifacts(tender_id, artifacts)
    log.info("saved: %s | %s score=%s | docs=%d | fields=%d",
             (detail.get("title") or "")[:40], row["verdict"], row.get("competitiveness_score"),
             len(artifacts), len(ex.get("all_fields") or []))
    return row["verdict"]


# ── CLI entrypoint (cron / manual) ─────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    for _noisy in ("httpx", "httpcore", "paddle", "paddlex", "paddleocr", "PIL"):
        logging.getLogger(_noisy).setLevel(logging.WARNING)
    rid = store.create_run("scheduled")
    print(f"run_id={rid}")
    try:
        run_cycle(rid)
    except Exception as e:  # noqa: BLE001
        store.emit(rid, "error", f"Cycle failed: {e}")
        store.update_run(rid, status="failed", completed_at=_now())
        raise
