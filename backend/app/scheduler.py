"""In-process scheduler — auto-fires a full agent run at a configured IST time.

No external dependency: a daemon thread ticks every 30s, reads the schedule from the
Supabase `company_profiles` row, and triggers a scan once per interval on/after the
configured `schedule_time_ist` (HH:MM). Key correctness points:
  • The per-day guard (`schedule_last_run`) is stamped ONLY AFTER a run actually starts —
    never before. (Stamping first meant a fire that couldn't start because a scan was
    already running still marked the day "done", so the auto-scan never actually ran.)
  • Catch-up window: it fires any time AT OR AFTER the scheduled minute on a due day, not
    only on the exact minute — a missed minute no longer skips the whole day.
  • If a due fire can't start (a scan is already active) it retries every 5 minutes until
    it starts; once it starts and stamps the day, it stops (no infinite triggering).
The scan uses the normal pipeline; its cycle_events flow into the chat as usual.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from .pipeline import ingest
from .supabase_client import service_client

log = logging.getLogger("scheduler")

_IST = timezone(timedelta(hours=5, minutes=30))
_started = False
_start_lock = threading.Lock()

_RETRY_AFTER_SEC = 300   # a due fire that couldn't start (a scan was already running) retries every 5 min
_next_retry_at: datetime | None = None   # single scheduler thread → a plain global is fine


def _profile_row() -> dict | None:
    try:
        res = (
            service_client()
            .table("company_profiles")
            .select("id,schedule_enabled,schedule_time_ist,schedule_interval_days,schedule_last_run")
            .is_("user_id", "null")
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as exc:  # noqa: BLE001
        log.warning("scheduler profile read failed: %s", exc)
        return None


def _interval_days(row: dict) -> int:
    """How many days between auto-runs (>=1). 1 = daily (the original behaviour)."""
    try:
        return max(int(row.get("schedule_interval_days") or 1), 1)
    except (TypeError, ValueError):
        return 1


def _due(last_run: str, today_date, interval: int) -> bool:
    """True if a scheduled run is due: never run before, or >= `interval` days since
    the last one (and not already today)."""
    last = (last_run or "").strip()
    if not last:
        return True
    if last == today_date.strftime("%Y-%m-%d"):
        return False  # already fired today
    try:
        last_d = datetime.strptime(last, "%Y-%m-%d").date()
    except ValueError:
        return True  # malformed stamp → treat as never run
    return (today_date - last_d).days >= interval


def _tick() -> None:
    global _next_retry_at
    row = _profile_row()
    if not row or not row.get("schedule_enabled"):
        return
    want = (row.get("schedule_time_ist") or "").strip()  # "HH:MM"
    if not want:
        return
    try:
        want_t = datetime.strptime(want, "%H:%M").time()
    except ValueError:
        log.warning("scheduler: bad schedule_time_ist %r — expected HH:MM", want)
        return
    now = datetime.now(_IST)
    # Catch-up window: fire any time AT OR AFTER the scheduled minute on a due day (not only
    # the exact minute), so a missed minute doesn't skip the whole day.
    if now.time() < want_t:
        return
    if not _due(row.get("schedule_last_run"), now.date(), _interval_days(row)):
        return  # already ran this interval — wait for the next due day
    # 5-minute retry gate: if the previous attempt in this window couldn't start, back off.
    if _next_retry_at is not None and now < _next_retry_at:
        return
    rid = ingest.start_run(triggered_by="scheduled")  # no limit → all live tenders, report when done
    if rid is None:
        # A scan is already running — do NOT stamp (that would burn the day). Retry in 5 min.
        _next_retry_at = now + timedelta(seconds=_RETRY_AFTER_SEC)
        log.info("scheduler: a run is already active — will retry in %d min", _RETRY_AFTER_SEC // 60)
        return
    # Started for real → NOW stamp the day so it won't fire again until the next interval.
    _next_retry_at = None
    try:
        service_client().table("company_profiles").update(
            {"schedule_last_run": now.strftime("%Y-%m-%d")}).eq("id", row["id"]).execute()
    except Exception as exc:  # noqa: BLE001 — run already started; a failed stamp only risks a re-fire
        log.warning("scheduler stamp failed after start (run %s): %s", str(rid)[:8], exc)
    log.info("scheduler fired scheduled scan (run %s) at %s IST (every %d day(s))",
             str(rid)[:8], want, _interval_days(row))


def _loop() -> None:
    while True:
        try:
            _tick()
        except Exception as exc:  # noqa: BLE001 — the scheduler thread must never die
            log.warning("scheduler tick error: %s", exc)
        time.sleep(30)


def start() -> None:
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, daemon=True, name="tender-scheduler").start()
    log.info("scheduler thread started (IST, 30s tick)")
