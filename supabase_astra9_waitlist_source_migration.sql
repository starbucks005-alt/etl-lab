-- Adds an optional "came from" tag to astra9_waitlist_emails, so sign-ups from
-- one place (the university exhibition QR code, 2026-10-06) can be counted
-- apart from everyone else. Nullable. Signups still work if this has not been run.
--
-- Run this once in the Supabase SQL editor.

alter table astra9_waitlist_emails
  add column if not exists source text;

-- Count by source:
-- select coalesce(source, 'website') as came_from, count(*) from astra9_waitlist_emails group by 1;
