-- ETL Design guest allowance.
-- Run once in the Supabase SQL editor.
--
-- WHY THIS TABLE EXISTS (2026-07-31)
-- The guest counter started in Netlify Blobs and could not work there. Blobs
-- defaults to eventual consistency, so the same guest ran three paid briefs in
-- a row: the write landed, the next read did not see it. Requesting strong
-- consistency then failed outright with
--   "Netlify Blobs has failed to perform a read using strong consistency
--    because the environment has not been configured with a 'uncachedEdgeURL'
--    property"
-- which is not available in this runtime. A spend counter needs a store where
-- a read after a write is guaranteed to see it, and Supabase already is that
-- store for etl_credits.
--
-- This is a SPEND CAP, not security. A guest id is browser-scoped and
-- clearable by design; the clean file still costs money either way.

create table if not exists etl_design_guests (
  guest_id    text primary key,
  used        integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Service role only. No anon or authenticated policy is granted, because the
-- browser must never be able to reset its own counter.
alter table etl_design_guests enable row level security;

comment on table etl_design_guests is
  'ETL Design free-brief allowance per anonymous browser. Written only by _design-credits.js with the service role key. Members spend from etl_credits instead; the owner is unmetered.';

-- Atomic increment, so two briefs fired at once cannot both read the same
-- count and each write back the same value. Returns the new total.
create or replace function etl_design_guest_spend(p_guest_id text, p_amount integer default 1)
returns integer
language plpgsql
as $$
declare
  new_used integer;
begin
  insert into etl_design_guests (guest_id, used)
  values (p_guest_id, p_amount)
  on conflict (guest_id) do update
    set used = etl_design_guests.used + p_amount,
        updated_at = now()
  returning used into new_used;
  return new_used;
end;
$$;
