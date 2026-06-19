-- Account-based, cross-device chat history. Run once in the Supabase SQL editor.
-- The backend uses the service key (bypasses RLS) and scopes every query by user_id;
-- RLS below is defense-in-depth for any direct client access.

create table if not exists public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  title      text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_sessions_user_idx on public.chat_sessions(user_id, updated_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role       text not null,                 -- 'user' | 'agent' | 'system'
  content    text not null default '',
  type       text not null default 'text',  -- 'text' | 'success' | 'error' | 'info'
  meta       jsonb,                          -- combined_url / report link etc.
  cycle_id   text,                           -- source cycle_events id (run report) — for dedup
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx on public.chat_messages(session_id, created_at);
-- a given run event lands in a session at most once (covers two devices open at once)
create unique index if not exists chat_messages_cycle_uniq
  on public.chat_messages(session_id, cycle_id) where cycle_id is not null;

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "own sessions" on public.chat_sessions;
create policy "own sessions" on public.chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
  for all
  using     (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid()));
