-- ============================================================
-- SLR Studio — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Profiles table (linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  TEXT UNIQUE NOT NULL,
  subscription_tier      TEXT NOT NULL DEFAULT 'individual',
  -- 'individual' | 'team' | 'institution' | 'gift'
  billing_period         TEXT NOT NULL DEFAULT 'monthly',
  -- 'monthly' | 'yearly' | 'gift'
  subscription_status    TEXT NOT NULL DEFAULT 'active',
  -- 'active' | 'canceled' | 'past_due'
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  is_admin               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast Stripe lookup
CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx
  ON public.profiles(stripe_customer_id);

CREATE INDEX IF NOT EXISTS profiles_stripe_sub_idx
  ON public.profiles(stripe_subscription_id);

-- ── Row Level Security ──────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile (limited fields — no tier/status changes)
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role (used by Netlify functions) bypasses RLS automatically.
-- No insert/delete policies needed for normal users.

-- ── Set yourself as admin ───────────────────────────────────
-- After signup, run this once to make yourself admin:
-- UPDATE public.profiles SET is_admin = TRUE WHERE email = 'starbucks005@gmail.com';

-- ── Trigger: keep updated_at current ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- Almost Human / EQ Room — exit survey ("End Conversation")
-- Written by netlify/functions/eq-room-rate.js, service-role only.
-- One row per End Conversation: the visitor's own 1-5 humanness
-- rating, next to the final per-turn emotion scales from the chat
-- (set turn-by-turn by eq-room-ask.js) and a model-generated score of
-- the same full conversation (agent_self_humanness/eq below), run
-- fresh at the moment the visitor leaves. The value in this dataset
-- is the GAP between the two numbers, not either alone. NAMING NOTE:
-- despite the column names, agent_self_humanness/eq is not the model
-- introspecting, it is a generated output shaped like a self-report,
-- from the same architecture as every other reply. Describe it in any
-- external writeup as "model-reported humanness/EQ", not "the agent's
-- self-assessment" — see the comment in eq-room-rate.js.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.etl_room_ratings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id           TEXT,
  visitor_name         TEXT,
  visitor_pronoun      TEXT,
  agent_key            TEXT NOT NULL,
  agent_name           TEXT,
  humanness_rating     SMALLINT NOT NULL CHECK (humanness_rating BETWEEN 1 AND 5),
  turn_count           INTEGER,
  -- Final per-turn emotion scales (0-100) at the moment the visitor left.
  happiness            NUMERIC,
  sadness              NUMERIC,
  fear                 NUMERIC,
  disgust              NUMERIC,
  anger                NUMERIC,
  surprise             NUMERIC,
  curious              NUMERIC,
  -- A model-generated score of its own replies across the full
  -- conversation (NOT introspection; see the header comment above).
  agent_self_humanness NUMERIC,
  agent_self_eq        NUMERIC,
  -- The full transcript this rating and score were computed from, so a
  -- reviewer (or Terry) can trace any number back to what was actually
  -- said, not just trust an average. [{role, content}, ...].
  transcript           JSONB,
  -- Optional one-line free text from the exit survey: what made it feel
  -- human or not, in the visitor's own words.
  visitor_note          TEXT,
  -- Version stamps so a persona/model change later doesn't silently mix
  -- with old data under the same column. Bump PERSONA_VERSION in
  -- _eq-personas.js whenever GUARDRAILS/TURN_OUTPUT_INSTRUCTIONS/personas
  -- change; judge_model is whatever ran the exit-judge call for this row.
  persona_version       TEXT,
  judge_model           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS etl_room_ratings_agent_idx
  ON public.etl_room_ratings(agent_key);

CREATE INDEX IF NOT EXISTS etl_room_ratings_created_idx
  ON public.etl_room_ratings(created_at);

ALTER TABLE public.etl_room_ratings ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (Netlify functions) can read or
-- write this table. Visitors never query it directly.

-- ── MIGRATION (2026-07-11): run once against the already-live table ────
-- CREATE TABLE above is IF NOT EXISTS, so it will not add these columns
-- to a table that already exists. Run this block once in the SQL editor:
--
-- ALTER TABLE public.etl_room_ratings
--   ADD COLUMN IF NOT EXISTS transcript      JSONB,
--   ADD COLUMN IF NOT EXISTS visitor_note    TEXT,
--   ADD COLUMN IF NOT EXISTS persona_version TEXT,
--   ADD COLUMN IF NOT EXISTS judge_model     TEXT;
