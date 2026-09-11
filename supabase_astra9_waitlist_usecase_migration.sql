-- Adds the optional "where would you put YOUR Astra-9" segmentation field
-- to the existing astra9_waitlist_emails table. Nullable, self-reported,
-- never blocks a signup if it's missing or invalid.
--
-- Run this once in the Supabase SQL editor.

alter table astra9_waitlist_emails
  add column if not exists use_case text;
