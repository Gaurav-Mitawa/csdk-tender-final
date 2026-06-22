-- Scheduler interval: auto-run the agent every N days (not just daily).
-- Settings → Automated scheduler → "Run every N day(s) at HH:MM IST".
-- Run once in the Supabase SQL editor.
alter table public.company_profiles
  add column if not exists schedule_interval_days integer not null default 1;  -- 1 = daily

-- Backfill any existing rows that predate the column.
update public.company_profiles
  set schedule_interval_days = 1
  where schedule_interval_days is null;
