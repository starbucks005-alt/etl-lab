# SLR Studio — Setup Guide
Complete this once. Takes about 30–45 minutes.

---

## Overview of what you're setting up
1. **Supabase** — free database + user authentication
2. **Netlify** — 5 environment variables + Stripe webhook endpoint
3. **Stripe** — 1 webhook, confirm your 6 price IDs
4. **One SQL command** — make yourself admin

---

## Step 1 — Create a Supabase Project

1. Go to **https://supabase.com** → Sign Up (free)
2. Click **New Project**
   - Name: `slr-studio`
   - Password: choose a strong password (save it)
   - Region: pick closest to your users (e.g., US East)
3. Wait ~2 minutes for the project to create

**Collect these values (you'll need them in Step 3):**
- Go to **Project Settings → API**
  - **Project URL** → looks like `https://abcdefgh.supabase.co`
  - **anon / public** key → long string starting with `eyJ...`
  - **service_role** key → another long string (keep secret!)

---

## Step 2 — Run the Database Schema

1. In Supabase, click **SQL Editor** in the left sidebar
2. Click **+ New Query**
3. Open `supabase-schema.sql` from your site folder and paste the entire contents
4. Click **Run** (green button)
5. You should see "Success. No rows returned"

---

## Step 3 — Set Netlify Environment Variables

1. Go to your Netlify site dashboard → **Site configuration → Environment variables**
2. Add each of these (click "Add variable" for each):

### Supabase variables
| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Your Project URL from Step 1 |
| `SUPABASE_ANON_KEY` | Your `anon / public` key from Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Your `service_role` key from Step 1 |

### Stripe variables
| Key | Value |
|-----|-------|
| `STRIPE_SECRET_KEY` | From Stripe Dashboard → Developers → API keys → **Secret key** (starts with `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | You'll get this in Step 4 — add it after |

### Stripe Price IDs
Go to **Stripe Dashboard → Products**. Click each product and find the Price ID (starts with `price_`).

| Key | Your Stripe Price ID |
|-----|---------------------|
| `PRICE_INDIVIDUAL_MONTHLY` | price_... ($29/mo) |
| `PRICE_INDIVIDUAL_YEARLY` | price_... ($249/yr) |
| `PRICE_TEAM_MONTHLY` | price_... ($79/mo) |
| `PRICE_TEAM_YEARLY` | price_... ($649/yr) |
| `PRICE_INSTITUTION_MONTHLY` | price_... ($299/mo) |
| `PRICE_INSTITUTION_YEARLY` | price_... ($2,499/yr) |
| `PRICE_GIFT` | price_... ($0 gift) |

---

## Step 4 — Set Up Stripe Webhook

1. Go to **Stripe Dashboard → Developers → Webhooks**
2. Click **+ Add endpoint**
3. **Endpoint URL:** `https://slrstudio.online/.netlify/functions/stripe-webhook`
4. **Events to listen for** — select these 4:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **Add endpoint**
6. Click the webhook you just created → **Signing secret → Reveal**
7. Copy the `whsec_...` value
8. Go back to Netlify → Add environment variable:
   - Key: `STRIPE_WEBHOOK_SECRET`
   - Value: the `whsec_...` value

---

## Step 5 — Replace Supabase Placeholders in HTML Files

The HTML files have `%%SUPABASE_URL%%` and `%%SUPABASE_ANON_KEY%%` placeholders.
Replace them with your real values in **3 files**: `index.html`, `login.html`, `admin.html`, and `app.html`.

**Quickest way — find & replace in a text editor:**

In each file, replace:
- `%%SUPABASE_URL%%` → your Supabase Project URL (e.g., `https://abcdefgh.supabase.co`)
- `%%SUPABASE_ANON_KEY%%` → your anon/public key

The `app.html` file also has these placeholders in the auth guard at the top of `<body>`.

---

## Step 6 — Deploy to Netlify

1. Upload your updated site folder to Netlify (drag-and-drop the folder, or push to GitHub)
2. Netlify will install the function dependencies automatically via `package.json`
3. Wait for the deploy to complete (~2 min)

---

## Step 7 — Make Yourself Admin

1. Go to your Netlify site → open `https://slrstudio.online/login.html`
2. Click **Forgot Password** and enter: `starbucks005@gmail.com`
3. Check your email and set a password
4. After logging in, go back to **Supabase → SQL Editor → New Query**
5. Run this command:
   ```sql
   UPDATE public.profiles SET is_admin = TRUE WHERE email = 'starbucks005@gmail.com';
   ```
6. Now go to `https://slrstudio.online/admin.html` — you should have full access

---

## Step 8 — Test the Full Flow

1. **Test purchase:** Use a Stripe test card (`4242 4242 4242 4242`, any future date, any CVC)
   - You need to switch to **Test Mode** in Stripe first, and use test price IDs
   - Or do a real $29 purchase and refund it immediately
2. **Verify webhook:** Stripe Dashboard → Webhooks → your endpoint → Recent deliveries
3. **Verify account:** Check Supabase → Table Editor → profiles — new row should appear
4. **Verify login:** Use the email you bought with → login.html → should land on app.html

---

## Granting Gift Access (Graduating Students)

1. Go to `https://slrstudio.online/admin.html`
2. Click **+ Gift Access**
3. Enter the student's email, leave tier as "Gift"
4. Click **Grant Access**
5. Student will receive an email with a password setup link

---

## Troubleshooting

**"Supabase not configured"** on admin page → You haven't replaced the `%%` placeholders yet (Step 5)

**Webhook not firing** → Check Stripe → Developers → Webhooks → your endpoint → Recent deliveries for errors

**User paid but no account created** → Check Netlify → Functions → stripe-webhook → function log for errors

**Login says "Profile not found"** → The webhook ran but the profiles row wasn't created. Check the webhook log in Netlify.

**App shows auth guard forever** → Network issue loading Supabase CDN. Check browser console.

---

## File Reference

| File | Purpose |
|------|---------|
| `index.html` | Public landing page with pricing |
| `login.html` | Login + forgot password |
| `app.html` | Protected SLR Studio tool |
| `admin.html` | Admin user management |
| `netlify.toml` | Netlify routing config |
| `package.json` | Function dependencies |
| `supabase-schema.sql` | Run once in Supabase SQL Editor |
| `netlify/functions/create-checkout.js` | Creates Stripe checkout sessions |
| `netlify/functions/stripe-webhook.js` | Handles Stripe payment events |
| `netlify/functions/get-user.js` | Returns logged-in user profile |
| `netlify/functions/admin-users.js` | Returns all users (admin only) |
| `netlify/functions/grant-access.js` | Grant/revoke/gift access (admin only) |
