# Stocks PA — build spec

Internal planning doc for the Stocks add-on to the ETL Personal Assistant
product. Triggered by Dr. Sethi's interest in an AI agent that can work
against his Robinhood account. Captures scope, architecture, build phases,
compliance boundaries, and pricing.

---

## Purpose

A personal assistant configured to know your money the way Auggie knows
Dr. O's calendar. Watches the portfolio, reads the filings, reports back
in voice every morning, alerts you when something moves outside normal.

The standard product is **monitor + brief + alert**. Execution-capable
agents (PAs that actually place trades) are available only as a custom
build, on express request, with appropriate disclosures and a written
scope. We do not auto-trade by default.

## Who it's for

- **Retail-active investors** who want one daily place to see what their
  positions did and what is coming.
- **PIs and faculty with sabbatical / consulting income** who do not want
  to open a brokerage app every day.
- **Operators and founders** with cap-table exposure who want a quiet
  feed instead of a CNBC firehose.
- **High-net-worth individuals with managed and self-directed accounts**
  who want a single readout across both.

NOT for: institutional traders (different tooling), professional advisors
(this is for end clients), or anyone who wants signals to act on without
their own judgment.

---

## What's in the box (standard build)

### Daily morning brief (in your PA's voice)

- Portfolio status overnight: what moved, what didn't, why
- Earnings hit overnight or scheduled today on held positions
- News on held tickers (web_search, last 24h)
- SEC EDGAR filings on held tickers (8-K, 10-Q, S-1, 13D/G)
- Sector rotation context (broad strokes, not a thesis)
- One thing to watch today, named

### Alerts (push or email, configurable)

- Price moves outside your defined band on flagged tickers
- Earnings surprise vs consensus on held positions
- Insider activity (Form 4) on held tickers
- News on flagged tickers above a configurable significance threshold
- Index-level circuit breakers, halts on held names

### Chat queries (on demand)

- "What did my portfolio do this week?"
- "What's the earnings calendar next week for my holdings?"
- "Any 8-K filings I missed?"
- "Why did NVDA drop today?" (web_search-grounded answer)
- "What's the consensus on this morning's CPI print?"

### Weekly review (Sundays, optional)

- Portfolio performance vs S&P / sector benchmark
- Concentration risk flag if any position > X% of total
- Realized vs unrealized gains breakdown
- Tax-loss harvesting candidates (read-only, not advice)

---

## What's NOT in the box by default

### No execution

We do not place trades. Period. By default the PA reads from your
brokerage and writes nowhere. Execution-capable variants exist as a
custom build with the full compliance stack (see below).

### No advice

The PA can describe what happened and what's scheduled. It does not say
"buy this," "sell that," or "rotate into X." It will tell you the
consensus, the analyst ratings, the news, the filings. The interpretation
is yours.

### No advisor relationship

Using the PA does not create an investment adviser relationship with the
laboratory or with Dr. Oroszi. Standard disclosures on every brief and
every alert. This is information presentation, not personalized advice.

### No tax advice

Tax-loss harvesting flagging is mechanical (we surface candidates by
threshold). It is not tax advice. We say so in the brief.

---

## Architecture

### Data sources

| Source | Purpose | Cost | Auth |
|---|---|---|---|
| **Robinhood API** (unofficial) OR **Plaid Investments** (sanctioned) | Read positions, balances, transactions, watchlist | Robinhood: free but TOS-risk; Plaid: ~$0.30/account/mo | OAuth |
| **Alpaca Markets API** (alternative brokerage with first-class API) | If user moves account to Alpaca, full official support | Free for paper, paid for live | OAuth |
| **AlphaVantage** OR **Finnhub** OR **Polygon** | Price data, fundamentals, earnings calendar | $50-200/mo per data tier | API key |
| **SEC EDGAR** | Filings (8-K, 10-Q, 10-K, Form 4, S-1, 13D/G) | Free | None |
| **Anthropic web_search** | News, analyst commentary, sector context | Per-search cost | Anthropic API key |
| **ElevenLabs** | Voice rendering for the morning brief | Per-character cost | Already wired |

**Recommendation:** Default to **Plaid Investments** for brokerage read,
not Robinhood directly. Plaid is sanctioned (Robinhood unofficial API is
TOS-grey). Plaid supports Robinhood, Fidelity, Schwab, Vanguard, E\*TRADE,
Coinbase — one integration covers everywhere. Cost: ~$0.30 per linked
account per month, trivial vs subscription.

If Dr. Sethi specifically wants Robinhood-native (because the buzz is
"AI agent on Robinhood"), build to Robinhood's official API where
available, fall back to Plaid otherwise.

### Functions to build

Mirroring the existing Auggie pattern (one function per concern):

1. **`stocks-pa-link.js`** — OAuth flow to link a brokerage account via
   Plaid Link. JWT-gated. Stores access token in Supabase.
2. **`stocks-pa-positions.js`** — GET, reads positions from the linked
   broker. JWT-gated.
3. **`stocks-pa-watchlist.js`** — GET/POST, manages user's flagged
   tickers. JWT-gated.
4. **`stocks-pa-brief-background.js`** — runs daily before the main PA
   brief, gathers positions, news, filings, earnings; produces a
   structured digest the main brief generator picks up and weaves into
   the monologue.
5. **`stocks-pa-alerts-cron.js`** — fires every 15 minutes during market
   hours, checks for alert conditions, sends push/email.
6. **`stocks-pa-edgar-watch.js`** — polls EDGAR daily for new filings on
   held + watchlist tickers.

### Storage (Supabase)

```sql
tg_stocks_accounts        -- linked brokerage accounts (user_id, plaid_item_id, broker_name, linked_at)
tg_stocks_watchlist       -- user-flagged tickers (user_id, ticker, added_at, alert_band_pct)
tg_stocks_position_snapshots  -- daily snapshot of positions for "what changed" diffs
tg_stocks_alerts          -- alert log + send status
tg_stocks_earnings_calendar  -- cached earnings dates for held + watchlist
```

### Integration with Auggie / main PA brief

Stocks PA is a **module** that injects into the existing morning brief
pipeline. The main `studio-auggie-brief-background.js` (or whatever brief
fn runs for a non-Auggie PA) calls a `getStocksDigest()` helper that
returns:

```js
{
  available: true,
  newCount: 7,  // events, alerts, filings since last brief
  digest: "Three of your holdings reported earnings overnight. NVDA up 8 percent after-hours on Q3 beat. AAPL flat. Two SEC 8-K filings on your watchlist...",
  items: [...]
}
```

The brief monologue prompt is updated to include stocks digest right
after the inbox section and before personal-mentions.

### MCP / cross-agent

The Stocks PA can also expose a tool to the PA's chat layer ("ask Auggie
about your portfolio"). When the chat function detects a stocks question
and the user has the add-on enabled, it calls the same helpers and gives
the model the data to answer with. Same pattern as the web_search tool.

---

## Build phases

### Phase 1 — MVP (2 weeks, $5K-7K custom build OR included in $49/mo add-on once productized)

- Plaid Link integration
- Read positions for one linked account
- Daily digest injected into morning brief
- Basic watchlist (manual ticker entry)
- One alert type: price move > X% on any held position

Ships as the "Stocks $49/mo" add-on listed on the public builder. This
is what Dr. Sethi gets if he wants the standard product.

### Phase 2 — Watchlist depth + EDGAR (2-3 weeks, +$3K-5K if custom)

- Multi-account support
- EDGAR filings watch on held + watchlist tickers
- Earnings calendar integration
- Insider activity (Form 4) alerts
- Configurable alert bands per ticker

### Phase 3 — Execution (6-8 weeks, custom build only, $15K+ + ongoing)

For PAs that actually trade. Requires:

- Written client scope agreement (what trades are authorized, position
  size limits, sector limits, max daily loss)
- Per-trade disclosures: PA logs every order before placing it
- Two-step confirmation by default (PA proposes, user clicks to send)
  unless explicitly authorized for autonomous execution within scope
- Full audit trail in immutable storage
- Compliance review of the deployment by a securities attorney (we
  retain one for the custom-build clients who need this)

This is Dr. Sethi's likely ask if he says "I want it to actually trade."
If he does, the build is bespoke, the price is higher, and the lead time
is real.

---

## Compliance / legal

### Investment Adviser registration

If we provide personalized investment advice for compensation, we may
trigger Investment Advisers Act registration (or state equivalent). The
Standard product avoids this by:

- Presenting information, not opinions
- Not recommending specific actions
- Not customizing recommendations to client circumstances

Phase 3 (execution-capable) is where this gets real. Counsel review
required before any execution-capable PA ships.

### Disclosures (standard product)

Every brief and every alert includes:

> Informational only. Not investment, tax, or legal advice. Data may be
> delayed. Verify before acting.

In Auggie's voice (if his persona is configured for stocks):

> "...and remember, Ms. Terry, this is information. I am not your
> advisor. Verify before you act."

### Data handling

- Brokerage access tokens stored encrypted in Supabase
- No raw position data leaves Netlify/Supabase
- User can revoke link any time (Plaid disconnect flow)
- Standard SOC 2 posture inherited from Supabase + Netlify
- We do not sell or share position data, period

### Audit trail

- Every alert logged with timestamp + condition that triggered it
- Every brief stored with transcript + sources
- Every linked-account action logged
- 7-year retention by default

---

## Pricing

### Standard ($49/mo as add-on, included in Pro and Executive)

- 1 linked brokerage account (Plaid)
- Daily portfolio digest in morning brief
- Up to 25 watchlist tickers
- Price-move alerts on held + watchlist
- Earnings calendar
- EDGAR filings watch
- Weekly review

### Custom (by quote)

Execution-capable PAs, multi-account aggregation across more than 3
brokers, tax-lot-level reporting, custom API integrations (Bloomberg
Terminal, FactSet, MorningStar Direct), white-labeled deployments.

Typical custom build: **$15K-25K build** + **$1,499/mo+** for ongoing.

### Dr. Sethi specifically

Scoping call should answer:

1. Read-only monitoring, or actual trade execution?
2. One brokerage (Robinhood) or multiple?
3. Does he want this for himself, or is he building a product to resell
   to his clients/network?
4. What's the user count he's planning for (1, 10, 1,000)?
5. Voice persona — Auggie-style or his own designed PA?
6. Timeline pressure?

If read-only + Robinhood + himself: standard $49/mo add-on, 2 weeks.
If execution + multi-broker + white-label: custom build, 6-12 weeks,
$25K+ + $1,499/mo+ per seat, counsel review required, separate contract.

---

## Open questions for Terry

1. Are we comfortable storing brokerage access tokens? If yes, who
   handles a breach disclosure? If no, we route through Plaid
   client-side only and pay the per-link fee.
2. Do we want to retain a securities attorney now (for the execution-
   capable variant), or wait until a paying client triggers the need?
3. Branding question: is "Stocks PA" the public name, or do we
   product-name it (e.g., "The Floor," "Ticker," "The Desk")? The
   product-named version reads better in marketing; "Stocks add-on"
   reads better in the builder.
4. Robinhood-specific branding: lead with "Robinhood-capable" because
   that's the current zeitgeist, or lead with "any major broker via
   Plaid" because it's broader and more defensible?

---

## Next actions

1. Call with Dr. Sethi to scope (answer the 6 questions in his section)
2. Decide Plaid vs Robinhood-native integration path
3. If Phase 1 only: 2-week build, ship as the $49/mo add-on, use Dr.
   Sethi as the case study customer
4. If Phase 3 (execution): retain securities counsel before any code,
   draft scope agreement template, then build

This spec is internal. It is not yet a public marketing page. The public
page (with "Robinhood-capable" badge) on `/build-your-pa.html` is the
funnel into a conversation, not a commitment to all of the above. The
conversation is where we figure out which path applies.
