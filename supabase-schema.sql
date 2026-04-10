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
