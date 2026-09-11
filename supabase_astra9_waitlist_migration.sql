-- astra9_waitlist_emails: interest-list signups from the Astra-9 "coming soon"
-- page (astra9.html). No payment, no auth, just an email captured so Dr. O can
-- reach people once the physical companion has something real to show.
--
-- Run this once in the Supabase SQL editor.

create table if not exists astra9_waitlist_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  unique (email)
);

alter table astra9_waitlist_emails enable row level security;
