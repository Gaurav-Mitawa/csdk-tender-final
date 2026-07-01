-- ============================================================================
-- Issue 6 — duplicate / corrigendum handling
--
-- The same real tender is often re-listed by TenderKart under a NEW uuid (a new
-- closing date / minor amendment). The old dedup keyed only on tenderkart_id, so
-- re-lists slipped through as fresh tenders (wasted tokens + repeated in reports).
--
-- These columns let the pipeline match on a CONTENT IDENTITY (normalized
-- title + issuing authority + reference number):
--   • identity already stored, nothing changed  -> exact duplicate, skipped
--   • identity stored but deadline/value/EMD changed -> CORRIGENDUM: the SAME row
--     is updated in place, flagged, with the list of changes.
--
-- SAFE + IDEMPOTENT. Run this ONCE in the Supabase SQL editor BEFORE (or right
-- after) deploying the matching backend — the code degrades gracefully if the
-- columns are missing, but dedup only activates once they exist.
-- ============================================================================

alter table public.tenders
  add column if not exists content_identity    text,
  add column if not exists is_corrigendum      boolean not null default false,
  add column if not exists corrigendum_changes jsonb,
  add column if not exists corrigendum_of      text;

-- Fast identity lookups during ingest.
create index if not exists tenders_content_identity_idx
  on public.tenders (content_identity);

-- Backfill identity for the existing rows so future re-lists dedupe against them.
-- MUST match the Python _identity_key(): lower(...) with every non-alphanumeric
-- character stripped, for title | issuing_authority | reference_number, joined by '|'.
update public.tenders
set content_identity =
      regexp_replace(lower(coalesce(title, '')),             '[^a-z0-9]+', '', 'g')
      || '|' ||
      regexp_replace(lower(coalesce(issuing_authority, '')), '[^a-z0-9]+', '', 'g')
      || '|' ||
      regexp_replace(lower(coalesce(reference_number, '')),  '[^a-z0-9]+', '', 'g')
where content_identity is null;

-- NOTE: a UNIQUE constraint on content_identity is intentionally NOT added — the
-- existing data already contains identity-duplicates from past re-lists, which the
-- app now collapses in code. Add a unique index later, after a one-time cleanup of
-- those legacy duplicate rows, if you want DB-level enforcement.
