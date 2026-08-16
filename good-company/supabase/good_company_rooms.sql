-- ═══════════════════════════════════════════════════════════════════════════
-- GOOD COMPANY — SHARED ROOMS
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to run twice: everything is IF NOT EXISTS.
--
-- WHAT THIS IS FOR, in plain terms.
-- A conversation with your friend normally lives only in your browser. Your
-- daughter's browser has no way to see it. These three tables are the shared
-- place both browsers can reach, and they only come into existence when
-- somebody presses "Bring someone with you". Talking to your friend on your
-- own touches none of this.
--
--   gc_rooms     one row per shared room
--   gc_people    one row per person sitting in one
--   gc_messages  one row per thing said
--
-- THE ARRIVAL-FORWARD RULE IS THE WHOLE POINT OF gc_people.joined_at.
-- Somebody who walks in at four o'clock sees the conversation from four
-- o'clock, never before it. Kept for PRIVACY, not for compliance: The Dose
-- forgets because it is a health product under HIPAA, and Good Company has no
-- such obligation. Same rule, different reason, and the reason matters,
-- because under privacy logic the host obviously keeps their own transcript
-- forever. NOTHING HERE EVER DELETES A FRIEND'S MEMORY.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── the room ───────────────────────────────────────────────────────────────
create table if not exists public.gc_rooms (
  id            uuid primary key default gen_random_uuid(),

  -- Which friend is in the room, and which of their scenes everybody is
  -- looking at. THE SCENE IS SHARED: if you are both sitting with Arch at the
  -- fireplace then you are both at the fireplace, so the host changes it and
  -- everyone follows. A skin is NOT here, because that is how somebody's own
  -- screen looks rather than where they are.
  friend        jsonb       not null,
  scene_key     text,

  -- Held as a deadline rather than a boolean, so a request that dies midway
  -- frees the room by itself instead of jamming it.
  busy_until    timestamptz,

  closed        boolean     not null default false,
  created_at    timestamptz not null default now(),

  -- A room is a sitting, not an archive. The friend's memory is elsewhere and
  -- is never touched by this expiring.
  expires_at    timestamptz not null default (now() + interval '12 hours'),

  -- Open by default, because a guest wanting to show their mum is the product
  -- spreading on its own. A host who would rather it did not grow can shut it.
  guests_may_invite boolean not null default true
);


-- ── who is in it ───────────────────────────────────────────────────────────
create table if not exists public.gc_people (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.gc_rooms(id) on delete cascade,

  -- The seat token IS the credential. Nobody at this table has an account, so
  -- there is no session to key anything on. An invite token and a seat token
  -- are the same shape and deliberately different values: the invite is
  -- swapped for a fresh seat token at the door, so a link that gets forwarded
  -- around cannot be replayed as somebody else's seat.
  token       text not null unique,

  -- Optional ON PURPOSE. A guest in a hurry skips it, and then the friend gets
  -- to ask what they would like to be called, which is a better first thirty
  -- seconds than any onboarding copy.
  display_name text,

  -- Asked for, never guessed. A name tells you nothing about pronouns, and
  -- guessing wrong misgenders a real person in a way the neutral default does
  -- not. Defaulted accordingly.
  pronouns    text not null default 'they / them',

  -- An emoji, or a tiny data URL. The picture is cropped and resized to 96px
  -- in the browser before it ever leaves it, so this is a couple of KB and
  -- there is no storage bucket, no upload endpoint and nothing large in
  -- flight. A guest with no account can still have a face.
  avatar      text,

  is_host     boolean     not null default false,

  -- THE ARRIVAL-FORWARD RULE LIVES HERE. Everything this person may read is
  -- bounded below by this timestamp.
  joined_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  removed     boolean     not null default false,

  -- Their own answer, asked at the door, on M.E.'s pattern: the guest decides
  -- for themselves whether the friend keeps anything about them, before they
  -- have said a word. The host does not decide it on their behalf.
  remember_me boolean     not null default false
);

create index if not exists gc_people_room on public.gc_people (room_id);
create index if not exists gc_people_token on public.gc_people (token);


-- ── what was said ──────────────────────────────────────────────────────────
create table if not exists public.gc_messages (
  id          bigserial primary key,
  room_id     uuid not null references public.gc_rooms(id) on delete cascade,

  -- 'friend' or 'person'.
  speaker     text not null check (speaker in ('friend','person')),

  -- Which seat said it. Null when the friend did.
  author_id   uuid references public.gc_people(id) on delete set null,

  -- Denormalised on purpose: what somebody was called at the moment they spoke
  -- should not change retroactively if they later change their name.
  name        text,

  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists gc_messages_room_time
  on public.gc_messages (room_id, created_at);


-- ── nobody reaches these except through the functions ──────────────────────
-- Deny-all RLS with no policies. Every one of these tables is touched only by
-- the Netlify functions using the service role key, which bypasses RLS, and
-- those functions are where the guarantees actually live:
--
--   * a caller is whoever their seat token says they are, or nobody
--   * a room id is NEVER taken from a request body, only from the seat
--   * the read floor is the caller's own joined_at and cannot be argued down
--
-- Stating that plainly rather than implying the database is protecting
-- anything. It is not. The functions are.
alter table public.gc_rooms    enable row level security;
alter table public.gc_people   enable row level security;
alter table public.gc_messages enable row level security;


-- ── housekeeping ───────────────────────────────────────────────────────────
-- Old sittings, swept. Rooms only: this cannot touch a friend's memory,
-- because a friend's memory is not in here.
create or replace function public.gc_sweep_expired_rooms()
returns void language sql as $$
  delete from public.gc_rooms
   where expires_at < now() - interval '2 days';
$$;
