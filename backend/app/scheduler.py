"""In-process scheduler — auto-fires a full agent run at a configured IST time.

No external dependency: a daemon thread ticks every 30s, reads the schedule from the
Supabase `company_profiles` row, and triggers a scan when the current IST time matches
`schedule_time_ist` (HH:MM). A per-day guard (`schedule_last_run`) prevents double-firing
across restarts. The scan uses the normal pipeline (fetch all live tenders → process →
report when the live list is exhausted), and its cycle_events flow into the chat as usual.
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
    row = _profile_row()
    if not row or not row.get("schedule_enabled"):
        return
    want = (row.get("schedule_time_ist") or "").strip()  # "HH:MM"
    if not want:
        return
    now = datetime.now(_IST)
    today = now.strftime("%Y-%m-%d")
    if now.strftime("%H:%M") != want:
        return  # not the scheduled minute (loop ticks every 30s, so each minute is checked)
    if not _due(row.get("schedule_last_run"), now.date(), _interval_days(row)):
        return  # fired recently — wait for the interval to elapse
    # Stamp the date FIRST so a slow run can't double-fire on the next tick.
    try:
        service_client().table("company_profiles").update({"schedule_last_run": today}).eq("id", row["id"]).execute()
    except Exception as exc:  # noqa: BLE001
        log.warning("scheduler mark failed: %s", exc)
        return
    log.info("scheduler firing scheduled scan at %s IST (every %d day(s))", want, _interval_days(row))
    rid = ingest.start_run(triggered_by="scheduler")  # no limit → all live tenders, report when done
    if rid is None:
        log.info("scheduler: a run is already active — skipped this fire")


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
