-- ============================================================================
-- FINALLLLL CHANGE — Supabase schema status for the latest report/agent round.
--
-- TL;DR: NO NEW COLUMNS are required for this round. Every new report field —
--   • procurement_basis  (why this procurement model fits)
--   • payment_terms      (Payment Structure: milestone %/Rs)
--   • page_refs          ("p2 of RFP" per important field)
--   • narrated gaps_to_address (tender-spec gaps vs CS Direkt data)
-- is stored inside the existing `tenders.extracted_data` (jsonb) or the existing
-- `tenders.gaps_to_address` column. So there is nothing new to run.
--
-- This file is just an IDEMPOTENT safety-net: run it to GUARANTEE every column
-- the code writes already exists (harmless if they do). Safe to re-run.
-- ============================================================================

-- ── tenders: columns the ingest/report write (all should already exist) ──────
alter table public.tenders
  add column if not exists pre_bid_date          text,
  add column if not exists sow_page_refs         jsonb,
  add column if not exists documents_required    text[],
  add column if not exists bidding_capacity      text,
  add column if not exists multiplier_factor     text,
  add column if not exists gaps_to_address       text[],
  add column if not exists extracted_data        jsonb;   -- holds extras{procurement_basis,payment_terms,...}, page_refs, all_fields

-- ── company_profiles: settings the RULES/report read (already added earlier) ─
alter table public.company_profiles
  add column if not exists analysis_instructions text,
  add column if not exists auto_reject_risks     text,
  add column if not exists legal_items           jsonb default '[]',
  add column if not exists partial_margins        jsonb default '{}',
  add column if not exists partial_margin_pct      numeric default 5,
  add column if not exists turnover_last_year_cr   numeric,
  add column if not exists turnover_3yr_avg_cr      numeric,
  add column if not exists net_worth_3yr_avg_cr     numeric,
  add column if not exists bank_solvency_cr         numeric;

-- Nothing else to do. The new fields live in tenders.extracted_data (jsonb).
