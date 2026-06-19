-- Scheduler: auto-run the agent at a set IST time (Settings → Automated scheduler).
-- Run once in the Supabase SQL editor.
alter table public.company_profiles
  add column if not exists schedule_enabled  boolean default false,
  add column if not exists schedule_time_ist text,          -- "HH:MM" IST, e.g. "09:00"
  add column if not exists schedule_last_run text;           -- YYYY-MM-DD IST (set by the scheduler)
