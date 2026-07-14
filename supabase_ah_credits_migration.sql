-- ah_credits — Almost Human's $9.99/mo paywall balance.
--
-- Keyed by an opaque access token (e.g. "AH-<32 hex chars>"), not a Supabase
-- Auth user: Almost Human has never asked a visitor to create an account, and
-- this paywall deliberately keeps it that way. The token is minted server-side
-- by verify-checkout-ah.js once a Stripe checkout is confirmed paid, and the
-- guest's browser holds it in localStorage the same way it already holds
-- etl_visitor_id.
--
-- Covers BOTH rooms: 1:1 messages deduct 1 credit, group messages deduct 3
-- (see _ah-credits.js for the constants). The free tier (no token) never
-- touches this table at all — its daily message cap lives in a separate
-- Netlify Blobs store (ah_daily_usage), since a rolling daily counter needs
-- no relational schema.
--
-- Run once in the Supabase SQL editor.

CREATE TABLE ah_credits (
  access_token            text PRIMARY KEY,
  email                   text,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  subscription_active     boolean NOT NULL DEFAULT true,
  balance                 integer NOT NULL DEFAULT 0,
  last_topped_up_at       timestamptz DEFAULT now(),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE ah_credits ENABLE ROW LEVEL SECURITY;
-- No public policies: the access token itself is the credential a guest
-- holds (not a Supabase session), so this table is only ever read/written
-- with the service-role key from Netlify functions, the same way
-- etl_conduct is used for anonymous, visitor_id-keyed state elsewhere on
-- this campus.
