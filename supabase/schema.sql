-- Tessera: tables for login + cloud sync (run once in the Supabase SQL editor).
-- Only the public `anon` key is used by the app; row level security limits every row to its owner.
-- Idempotent: safe to run again.

create table if not exists public.attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,                -- one id per device; used to de-duplicate
  ts           timestamptz not null,
  session_id   text not null,
  mode         text not null check (mode in ('spot','hand','post','postSpot')),
  solution     text not null,
  node_id      int  not null,
  hand         smallint not null check (hand between 0 and 168),
  seat         smallint not null check (seat between 0 and 5),
  spot         text not null,
  chosen       smallint not null,
  best         smallint not null,
  grade        text not null check (grade in ('best','correct','inaccurate','mistake','blunder')),
  ev_loss      real not null check (ev_loss >= 0),
  score        smallint not null check (score between 0 and 100),
  ms           int,
  flags        smallint not null default 0,  -- bit0 rng, bit1 timeout, bit2 hint
  unique (user_id, client_id, ts, node_id, hand)
);
create index if not exists attempts_user_ts on public.attempts (user_id, ts);

create table if not exists public.srs_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  node_id    int  not null default 0,
  hand       smallint not null default 0,
  box        smallint not null,
  due        timestamptz not null,
  seen       int not null,
  lapses     int not null,
  last_grade text not null,
  updated    timestamptz not null,
  primary key (user_id, key)
);
create index if not exists srs_user_updated on public.srs_items (user_id, updated);

create table if not exists public.range_presets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  name       text not null,
  range_text text not null,
  ts         timestamptz not null,
  primary key (user_id, id)
);
create index if not exists range_user_ts on public.range_presets (user_id, ts);

create table if not exists public.user_settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb not null,
  updated  timestamptz not null default now()
);

alter table public.attempts       enable row level security;
alter table public.srs_items      enable row level security;
alter table public.range_presets  enable row level security;
alter table public.user_settings  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['attempts','srs_items','range_presets','user_settings'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'own rows') then
      execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;
