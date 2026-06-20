-- export_keys — gates the public agent-ask / agent-status endpoints.
-- One key per customer site. Scope it to the specific agent(s) they bought.
-- Run this once in the Supabase SQL editor.

create table if not exists export_keys (
  id              uuid        primary key default gen_random_uuid(),
  key             text        not null unique,
  label           text,
  owner_id        text,
  allowed_agents  text[]      not null default array['*'],
  allowed_origins text[]      not null default array[]::text[],
  active          boolean     not null default true,
  calls_today     integer     not null default 0,
  calls_total     integer     not null default 0,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- Only the service-role key can read/write. Anon requests are blocked.
alter table export_keys enable row level security;
create policy "service_only" on export_keys using (false);

-- Increment usage counters atomically (called via RPC from agent-ask).
create or replace function increment_export_key_usage(p_key text)
returns void language plpgsql security definer as $$
begin
  update export_keys
     set calls_total  = calls_total + 1,
         calls_today  = calls_today + 1,
         last_used_at = now()
   where key = p_key;
end;
$$;

-- ── Mint a key (example — run manually in Supabase SQL editor) ───────────
-- insert into export_keys (key, label, owner_id, allowed_agents, allowed_origins)
-- values (
--   'sk-etl-CHANGE_ME',
--   'My website — Auggie',
--   'user@example.com',
--   array['august-auggie-vidal'],       -- or array['*'] for any agent
--   array['mywebsite.com']              -- or array[]::text[] for any origin
-- );

-- ── Daily call-count reset (run via pg_cron or an external cron) ─────────
-- update export_keys set calls_today = 0;
