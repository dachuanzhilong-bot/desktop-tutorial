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
  hand         smallint not null check (hand between 0 and 1325),   -- pre-flop: hand class 0..168; post-flop: combo 0..1325
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

-- Databases created from an older copy of this file limited `hand` to the 169 pre-flop classes, which rejects every
-- post-flop answer (a combo number up to 1325). Widen it; safe to run again, and a no-op on a fresh database.
alter table public.attempts drop constraint if exists attempts_hand_check;
alter table public.attempts add constraint attempts_hand_check check (hand between 0 and 1325);

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

create table if not exists public.icm_drill_log (
  user_id   uuid not null references auth.users(id) on delete cascade,
  ts        timestamptz not null,
  players   smallint not null check (players between 2 and 9),
  pos       text not null,
  stack     real not null check (stack >= 0),
  facing    text,
  hand      smallint not null check (hand between 0 and 168),
  chosen    smallint not null check (chosen in (0,1)),
  grade     text not null check (grade in ('best','correct','inaccurate','mistake','blunder')),
  ev_loss  real not null check (ev_loss >= 0),
  score     smallint not null check (score between 0 and 100),
  primary key (user_id, ts, hand, chosen)
);
create index if not exists icm_log_user_ts on public.icm_drill_log (user_id, ts);

create table if not exists public.study_bookmarks (
  user_id  uuid not null references auth.users(id) on delete cascade,
  id       text not null,
  created  timestamptz,
  ts       timestamptz not null,
  deleted  boolean not null default false,
  title    text,
  note     text,
  href     text,
  primary key (user_id, id),
  check (
    (deleted and created is null and title is null and note is null and href is null)
    or
    (not deleted and created is not null and title is not null and note is not null and href like '/study/%')
  )
);
create index if not exists bookmark_user_ts on public.study_bookmarks (user_id, ts);

-- A device may reconnect with an older local copy. Keep the newest server version.
create or replace function public.keep_newer_study_bookmark()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ts < old.ts or (new.ts = old.ts and old.deleted and not new.deleted) then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists study_bookmark_newest on public.study_bookmarks;
create trigger study_bookmark_newest
before update on public.study_bookmarks
for each row execute function public.keep_newer_study_bookmark();

create table if not exists public.user_settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb not null,
  updated  timestamptz not null default now()
);

alter table public.attempts       enable row level security;
alter table public.srs_items      enable row level security;
alter table public.range_presets  enable row level security;
alter table public.icm_drill_log  enable row level security;
alter table public.study_bookmarks enable row level security;
alter table public.user_settings  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['attempts','srs_items','range_presets','icm_drill_log','study_bookmarks','user_settings'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'own rows') then
      execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    end if;
  end loop;
end $$;
