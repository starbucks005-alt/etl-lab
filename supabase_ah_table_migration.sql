-- ────────────────────────────────────────────────────────────────────────────
-- etl_table_* — Almost Human's group table, with a second human in it.
--
-- The table (almost-human.html #table, netlify/functions/eq-room-group-ask.js)
-- has always held the whole conversation in one browser. This adds a second
-- person: the host makes a link, sends it however she likes, and her friend taps
-- it once and is sitting at the table. No sign-in, no account, on either side.
--
-- WHICH PROJECT THIS RUNS IN
-- --------------------------
-- The ETL campus project, ref ulvrnermyuvzanxhxoib — the one every Almost Human
-- function already hardcodes as SUPABASE_URL. That project is shared across the
-- campus, which is why every object here is prefixed etl_table_, matching
-- etl_conduct / etl_room_ratings / etl_agent_memories.
--
-- CONFIRM BEFORE YOU RUN THIS. The name SUPABASE_SERVICE_ROLE_KEY points at a
-- DIFFERENT database on other ETL sites (The Dose's is siaagtgakcxvnktlqomx).
-- Running this in the wrong one produces tables that pg_tables can see and the
-- REST API answers PGRST205 "could not find the table" for, which reads exactly
-- like a migration that never ran. That cost real hours on The Dose on
-- 2026-08-12. Check first:
--
--   select count(*) from pg_tables
--    where schemaname = 'public' and tablename = 'etl_conduct';   -- must be 1
--
-- WHY THERE IS NO auth.users ANYWHERE IN HERE
-- -------------------------------------------
-- Almost Human has never asked anyone to make an account and this does not
-- change that. The host already holds an opaque credential — the ah_credits
-- access token minted by verify-checkout-ah.js — and the guest is handed one at
-- the door. So both people at the table are token-bearers of the same kind, and
-- every table below is reached ONLY by a Netlify function holding the
-- service-role key. That is a real simplification over The Dose's version of
-- this feature, which had to carry a signed-in host and a token guest as two
-- separate shapes.
--
-- It also means RLS here is not doing the filtering: there is no auth.uid() for
-- a policy to key on, so every table has RLS on with NO policies (deny all) and
-- the privacy rule is enforced in application code. Said plainly rather than
-- pretended otherwise — see THE PRIVACY RULE below.
--
-- THE PRIVACY RULE, decided by Dr. O:
--   An invited guest sees the conversation ONLY FROM WHEN SHE ARRIVES.
--
-- Two halves, of different strength, and they are not the same guarantee:
--   * What she can SEE is enforced in ah-table-poll.js, which bounds every read
--     by the joined_at on her own etl_table_people row. The earlier rows never
--     leave the server. On The Dose this half was a Postgres read policy; here
--     it cannot be, because there is no session to key it on.
--   * What the cast may SAY about the earlier part is a prompt rule, applied in
--     eq-room-group-ask.js. The agents still generate from the full transcript,
--     or the host has to re-explain herself the second someone joins. That is an
--     instruction, not a guarantee, and the UI copy promises only the first half.
-- ────────────────────────────────────────────────────────────────────────────

-- ── rooms ───────────────────────────────────────────────────────────────────
create table if not exists public.etl_table_rooms (
  id                    uuid primary key default gen_random_uuid(),

  -- Who pays. The friend spends the host's credits (Dr. O's decision), and a
  -- guest must never see a balance, a paywall, or a top-up prompt: being asked
  -- to buy credits for someone else's room is a bad moment.
  --
  -- This is a REFERENCE, not a credential: sha256 hex of the host's AH access
  -- token, matched against ah_credits.token_ref (added at the bottom of this
  -- file). The obvious implementation was to store the access token itself, and
  -- it would have been defensible — ah_credits already holds that token in
  -- plaintext as its primary key, in this same database, behind this same
  -- service-role-only posture. The hash is here anyway because it costs nothing
  -- and it means a future function that carelessly selects * from this table
  -- cannot leak a live credential.
  --
  -- Null when the room was opened with the owner key, which pays nothing.
  host_credit_ref       text,
  host_is_owner         boolean not null default false,

  agent_keys            text[] not null,   -- everyone who sat down (never shrinks)
  active_agents         text[] not null,   -- who is still at it

  -- THE PORT-SPECIFIC PIECE. Each agent's emotion scales, meters, and turn
  -- count. In the solo table this lives in the browser and is posted back on
  -- every turn. With two humans there are two copies of it and they diverge on
  -- the first turn, whoever asks overwriting the other person's. So it lives
  -- here instead, read and written server-side under the turn lock below.
  agent_state           jsonb not null default '{}'::jsonb,

  visitor_message_count int not null default 0,
  closed                boolean not null default false,

  -- The turn lock. One cascade at a time: if both people type at once the
  -- second is told the table is busy rather than starting a second cascade from
  -- a transcript and an agent_state that are about to change underneath it.
  -- A deadline rather than a boolean, so a function that dies mid-cascade frees
  -- the room on its own instead of wedging it.
  busy_until            timestamptz,

  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '24 hours')
);

create index if not exists etl_table_rooms_created_idx
  on public.etl_table_rooms (created_at desc);

-- ── people ──────────────────────────────────────────────────────────────────
-- Host and guest in ONE table, because on this site they are the same shape:
-- somebody holding an opaque bearer token. `token` is the credential the
-- browser carries; `id` is the stable identity used for attribution, so the
-- credential never has to be compared anywhere but here.
--
-- visitor_id is the etl_visitor_id their browser already carries. It is what
-- conduct strikes and memory saves are keyed on everywhere else on this campus,
-- so a guest who abuses the table earns her OWN strike, not the host's.
create table if not exists public.etl_table_people (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.etl_table_rooms(id) on delete cascade,
  token        text unique not null,
  display_name text,
  pronoun      text,
  visitor_id   text,
  is_host      boolean not null default false,
  -- Everything this person is allowed to read is bounded by this column.
  joined_at    timestamptz not null default now(),
  removed      boolean not null default false,
  last_seen_at timestamptz
);

create index if not exists etl_table_people_room_idx
  on public.etl_table_people (room_id, joined_at);

-- ── messages ────────────────────────────────────────────────────────────────
-- speaker is an agent key ('ivy', 'auggie', ...) or 'visitor'. author_id is set
-- only on visitor lines, so the cast can attribute ("Terry asked X, Pookie
-- added Y") and so each person's own lines can be marked as theirs without any
-- browser being told anyone else's identifier.
create table if not exists public.etl_table_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.etl_table_rooms(id) on delete cascade,
  speaker    text not null,
  author_id  uuid references public.etl_table_people(id) on delete set null,
  name       text not null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists etl_table_messages_room_idx
  on public.etl_table_messages (room_id, created_at);

-- ── invites ─────────────────────────────────────────────────────────────────
-- Single use: claimed_at stays null until the first tap claims it, so a
-- forwarded link gets "this invite has already been used" rather than a second
-- stranger at somebody's table.
--
-- No email column of any kind. The host sends the link herself, however she
-- likes, so Almost Human never touches a third party's address. That is also
-- why there is no magic link here: v1 of this on The Dose invited the guest with
-- one and it failed in real use, because single-use links get prefetched and
-- burned by mail scanners before the human ever taps them.
create table if not exists public.etl_table_invites (
  token      text primary key,
  room_id    uuid not null references public.etl_table_rooms(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  claimed_at timestamptz
);

create index if not exists etl_table_invites_room_idx
  on public.etl_table_invites (room_id);

-- ── credit reference on ah_credits ──────────────────────────────────────────
-- What etl_table_rooms.host_credit_ref points at. Plain column, not generated:
-- computing sha256 over text inside Postgres means a cast whose immutability is
-- not worth betting a migration on, and it is not needed. ah-table-open.js has
-- the live token in hand at the only moment this matters and writes the ref
-- there, so there is nothing to backfill and no row that can be missing one
-- when it is actually needed.
alter table public.ah_credits
  add column if not exists token_ref text;

create unique index if not exists ah_credits_token_ref_idx
  on public.ah_credits (token_ref)
  where token_ref is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- On, with NO policies, on all four. Every one of these tables is reached only
-- by a Netlify function holding the service-role key, which bypasses RLS, so
-- there is nothing a browser should be able to select here. A row in
-- etl_table_people is a live credential to somebody else's conversation.
alter table public.etl_table_rooms    enable row level security;
alter table public.etl_table_people   enable row level security;
alter table public.etl_table_messages enable row level security;
alter table public.etl_table_invites  enable row level security;

-- ── GRANTS ──────────────────────────────────────────────────────────────────
-- RLS and GRANT are two different things and you need both. A policy filters
-- the rows a role can already reach; the grant is what lets the role reach the
-- table at all.
--
-- REVOKE FIRST, and this is the part that is easy to skip. On the Dose's project
-- the default privileges hand ALL privileges to anon and authenticated on every
-- new table in public, so a fresh table arrives wide open. RLS covers most of
-- that, since an anon caller matches none of the policies — but it does NOT
-- cover TRUNCATE, because PostgreSQL does not apply row-level security to
-- TRUNCATE at all. Deny-all RLS plus a lingering anon TRUNCATE grant means
-- anyone holding the publishable key can empty every table here.
--
-- Whether this project has the same default is not assumed either way. Revoking
-- is correct if it does and harmless if it does not.
revoke all on public.etl_table_rooms    from anon, authenticated;
revoke all on public.etl_table_people   from anon, authenticated;
revoke all on public.etl_table_messages from anon, authenticated;
revoke all on public.etl_table_invites  from anon, authenticated;

grant all on public.etl_table_rooms    to service_role;
grant all on public.etl_table_people   to service_role;
grant all on public.etl_table_messages to service_role;
grant all on public.etl_table_invites  to service_role;

notify pgrst, 'reload schema';

-- ── Sanity checks ───────────────────────────────────────────────────────────
-- Run these after the migration, in the same editor:
--
--   select count(*) from public.etl_table_rooms;    -- 0, and it answers at all
--
--   select tablename, count(policyname) from pg_policies
--    where tablename like 'etl_table%' group by tablename;
--   -- expect NO rows: deny-all is the intent, not an oversight
--
--   select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'etl_table_people'
--    group by grantee;
--   -- expect service_role (and the table owner) only. No anon, no authenticated.
--
--   select count(*) from information_schema.columns
--    where table_name = 'ah_credits' and column_name = 'token_ref';   -- 1
--
-- A correctly locked table answers 42501 "permission denied" to the anon key,
-- not 404. If you get PGRST205 instead, you are in the wrong project.
