# CC Handoff: make "Take Your Agent Anywhere" real (2026-06-20)

The explainer page `export-your-agent.html` is live and linked from the home grid
("Take It With You" -> `/export-your-agent`). The endpoints it shows are **illustrative**; this
doc is the build order to make them actually work. Mirror the existing async pattern
(`specialist-delia-ask/status/background.js`, the `city-*` triplets) and the Netlify Blobs job
store (`getStore('csuite_jobs')`). Anthropic, Gamma, and ElevenLabs keys are already in the env.

Goal: let an agent built on the campus run on a customer's own website three ways: an embed
widget, a public API, and (phase 2) the agent's MCP backpack.

---

## Deliverable 1 — Generic public agent runner (the core; everything else uses it)

Three functions in `netlify/functions/`, generic over any agent `slug`:

- **`agent-ask.js`** (public, CORS). `POST { agent, question, context?, history? }`, auth header
  `Authorization: Bearer <EXPORT_KEY>`. Validates the key and that it is allowed to use `agent`.
  Mints `job_id`, fires `agent-background`, returns `{ ok, job_id, polling_endpoint }`.
- **`agent-background.js`**. Loads the agent's persona + tools by slug (see "Agent registry"
  below), runs the Anthropic agentic loop (copy `specialist-delia-background.js` almost verbatim:
  tool loop, citation collection, `houseTypography` scrub), writes the result to the Blobs store
  at key `export/<slug>/<job_id>`.
- **`agent-status.js`** (public, CORS). `GET ?job_id=...&agent=<slug>`, same auth header. Reads
  the store, returns `{ status, response, error }`.

**Agent registry (slug -> persona + tools).** Build one resolver both ask and background call:
1. Look up the agent in `roster.json` by slug for name/role/tagline/bio (display + base persona).
2. If a backpack spec exists at `agent-backpacks/agents/<slug>.json`, load its `guardrail`,
   `backpack.tools` (with `binding.server`/`tool`), and `backpack.mcp` to wire the live tools.
3. System prompt = persona (role + bio + background) + guardrail + the house voice law
   (`_etl-voice-law.js`, the same `VOICE_LAW_CHAT` + no-em-dash scrub the other agents use).
4. In-framework agents (no backpack) run prompt-only, no tools.
Recommendation: ship a small `_agent-registry.js` helper so ask/background/status share one
loader and one prompt builder.

**CORS (critical, the embed runs on third-party domains).** All three functions must:
- Answer `OPTIONS` preflight with `Access-Control-Allow-Origin`, `-Methods: POST, GET, OPTIONS`,
  `-Headers: Content-Type, Authorization`.
- Echo an allowed origin. Start permissive-but-keyed (`*` with a required key), or better, store
  an allowlist of domains per key and echo only matches.

---

## Deliverable 2 — Embed widget (`/embed/agent.js`)

A self-contained script served from `etl-lab-push/embed/agent.js` (static asset). It:
- Reads `data-agent` (slug) and `data-key` from its own `<script>` tag (`document.currentScript`).
- Injects a small chat UI, ideally inside a **shadow root** so the host page's CSS can't break it.
- Calls `agent-ask` then polls `agent-status` with the key, renders the streamed answer.
- No external dependencies; vanilla JS; matches the ETL dark style but scoped so it does not leak.
The snippet on the page already shows the intended usage:
`<script src="https://emerging-tech-lab.com/embed/agent.js" data-agent="slug" data-key="..."></script>`

---

## Deliverable 3 — Key management (gates 1 and 2)

These endpoints cost real money (Anthropic + any backpack tools), so they must be keyed and
metered. Reuse Supabase (already wired in the specialist functions):
- Table `export_keys`: `key` (sk-etl-...), `label`, `owner_id`, `allowed_agents` (text[] or `*`),
  `allowed_origins` (text[]), `active` (bool), `created_at`, plus usage counters.
- `agent-ask`/`agent-status` validate: key exists, `active`, `agent` in `allowed_agents`, request
  origin in `allowed_origins` (for the embed). Reject with 401/403 otherwise.
- A way to mint/revoke keys: a small admin function or a row insert in Supabase. One key per
  customer site; scope it to the one or few agents they bought.
- Add per-key rate limiting and a daily cap so a leaked key can't run up the Anthropic bill.

---

## Deliverable 4 — MCP backpack exposure (phase 2, heavier)

Expose a backpack agent as a connectable MCP server at `/mcp/<slug>` so external assistants get
the agent's live tools. This is a real MCP-over-HTTP (streamable HTTP / SSE) server implementation
and key-gating, larger than 1-3. Recommend shipping 1 and 2 first, then this. The agent's tool
list comes from the same `agent-backpacks/agents/<slug>.json` `backpack.tools` + `mcp` servers.

---

## Build order
1. `_agent-registry.js` resolver (slug -> persona, guardrail, tools, model).
2. `agent-ask` / `agent-background` / `agent-status` with CORS, mirroring the Delia triplet.
3. `export_keys` table + key validation in ask/status; mint one test key.
4. `embed/agent.js` widget; test it on an external page with the test key.
5. Replace the illustrative endpoints/snippet on `export-your-agent.html` with the real ones.
6. Phase 2: `/mcp/<slug>` MCP server.

## Guardrails to keep
Every exported agent keeps the house rule: verify before you believe, advises not certifies, no
em dashes (run `houseTypography`). Keys are the customer's, revocable any time. Never bake a key
into client JS that isn't origin-scoped.
