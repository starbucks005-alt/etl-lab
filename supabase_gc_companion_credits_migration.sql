-- gc_companion_credits: per-companion subscriptions for Good Company.
-- Added 2026-08-28, Dr. O direct: "each companion has its own $9.99/mo
-- subscription and its own 300 credits, tracked separately." Mirrors
-- ah_credits' own shape (see supabase_ah_credits_migration.sql) but keyed
-- on (access_token, friend_id) instead of access_token alone, since a
-- single visitor can now hold several of these rows at once, one per
-- companion they've subscribed to.
--
-- Run this once in the Supabase SQL editor.

create table if not exists gc_companion_credits (
  id uuid primary key default gen_random_uuid(),
  access_token text not null,
  friend_id text not null,
  friend_name text,
  balance integer not null default 0,
  subscription_active boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_topped_up_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (access_token, friend_id)
);

create index if not exists gc_companion_credits_token_idx
  on gc_companion_credits (access_token);

alter table gc_companion_credits enable row level security;

-- Service-role key only, same policy shape as ah_credits: no anon/authenticated
-- access, every read and write goes through a Netlify function using the
-- service role key.
create policy "service role full access" on gc_companion_credits
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
