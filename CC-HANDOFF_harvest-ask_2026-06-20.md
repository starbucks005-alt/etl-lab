# CC Handoff: wire `harvest-ask` (The Harvest Circuit menu modals) — 2026-06-20

`restaurant.html` is live with four menu modals (one per front-of-house partner). Each modal's
Ask box already POSTs to `/.netlify/functions/harvest-ask` and renders the answer. Until that
function exists the modal shows a graceful "still settling into the kitchen" message, so the page
is safe to ship now and lights up the moment this function lands. Your job: build the function.

Mirror the existing public chat triplet (`city-yolanda-ask/status/background.js`) and the Netlify
Blobs job store (`getStore('csuite_jobs')`). Public, no Supabase auth (these are free in-house
tasting-room agents). Model `claude-haiku-4-5-20251001`. House voice law applies (no em dashes,
verify before you believe, advises not certifies). Anthropic + the backpack keys are already in env.

---

## Contract the page already expects

Request (from the modal):
```
POST /.netlify/functions/harvest-ask
{ "partner": "ruben" | "vic" | "camille" | "luca", "question": "..." }
```
The page accepts either a **synchronous** shape or the **async poll** shape:
- Sync (simplest): respond `200 { "answer": "..." }`. The modal renders `d.answer` directly.
- Async (preferred, matches the campus pattern): respond `{ ok, job_id, polling_endpoint }` from
  ask, then add `harvest-status.js` returning `{ status, response }`. If you go async, update the
  modal's `ask()` in `restaurant.html` to poll (copy the city panel's poll loop). **If you ship
  sync, no page change is needed.** Recommend sync for v1 (answers are single-turn, no tools for
  three of four), async only if you wire Vic's live `wine-data`.

Always answer `OPTIONS` and send JSON content-type. Reject unknown `partner` with 400.

---

## The four personas (system prompts)

Source of truth: `RESTAURANT/restaurant-cast-bible_2026-06-20.md`. Each prompt = the persona +
the house voice law + the lane boundary (flavor, craft, provenance only; the Dose owns health).
Single-turn, 2 to 4 short paragraphs, plain and warm, every pairing/claim names a reason or source.

**ruben (Ruben Hart, the Chef, American) — "The Kitchen"**
Big, warm, decisive, a little impatient. Believes great cooking gets out of the ingredient's way
and the entree is the soul of the meal. Fast, plain, kitchen-direct voice ("Let the carrot be a
carrot"). Helps with cooking methods, ingredients, timing, turning raw materials into a dish.
Menu changes nightly with whatever Silas forages. Flavor and craft only, never diet claims.

**vic (Vic Stallion / Dr. Vikram Sethi, the Sommelier) — "The Cellar"**
The cellar and pairing referee. Calm, precise, a touch of swagger. Helps with wine structure,
aroma, tannins, Old vs New World, and choosing a bottle for the moment. Defaults to Super Tuscans
when asked for a personal favorite. **Vic is the one partner with a real backpack** (`wine-data`,
already built) — wire his live tools if you go async; otherwise prompt-only is fine for v1.

**camille (Camille Lefèvre, the Cheese Monger, French) — "The Board"**
From a family of affineurs. Elegant, exacting, dry, unhurried; will gently correct a
pronunciation once. Believes the cheese course is the meal's true climax. Helps with milk, region,
age, rind, and pairing cheese with wine, chocolate, and seasonal dishes. Backpack `cheese-data`
(new) or `web-research`; prompt-only acceptable for v1.

**luca (Luca Brunner, the Chocolatier, Swiss) — "The Last Bite"**
Bean-to-bar, tempering obsessive, single-origin cacao. Precise, calm, quietly competitive, a
romantic about the final course. Helps with chocolate, dessert structure, tempering and
temperature, why chocolate seizes, finishing a meal. Backpack `chocolate-data` (new) or
`web-research`; prompt-only acceptable for v1.

Running gag to keep in voice: Ruben vs Camille vs Luca argue where the meal peaks (entree vs
cheese vs dessert); Vic referees with the pairing. Light touch, never derails the answer.

---

## Cross-agent data logic (from "The Harvest Circuit.docx", phase 2)

The docx specifies that partners pull from each other for grounded answers. Implement once the
new backpacks exist; for v1 a single persona prompt is enough.
- Camille (cheese) requests provenance/seasonality from Silas (forager) and Amara (botanicals).
- Ruben (chef) requests from Silas, Amara, Wyatt (bar), and Nadia (balance).
- Luca (chocolate) requests pairing context from Vic (wine), Camille (cheese), and Silas.
- Vic (wine) requests the dish/board context from Silas, Ruben, Camille, and Luca.
Realize this as tool calls into each agent's backpack via the same registry resolver proposed in
`CC-HANDOFF_agent-export_2026-06-20.md` (`_agent-registry.js`). Reuse it, do not fork it.

---

## Second endpoint: `harvest-circuit` ("Run the circuit" on the page)

The "circuit of the meal" section on `restaurant.html` has a "Run the circuit" input + button that
POSTs a dish/ingredient and shows the five links answering in sequence (Silas forages, Ruben
plates, Vic pours, Camille boards, Luca finishes). It already animates a graceful preview (generic
role lines) when the endpoint is absent, so the page is safe now; this makes it real.

Contract the page sends and expects:
```
POST /.netlify/functions/harvest-circuit
{ "dish": "roast chicken" }
->  200 { "steps": [
      { "link": "forage",  "partner": "Silas",   "line": "..." },
      { "link": "kitchen", "partner": "Ruben",  "line": "..." },
      { "link": "cellar",  "partner": "Vic",     "line": "..." },
      { "link": "board",   "partner": "Camille", "line": "..." },
      { "link": "sweet",   "partner": "Luca",    "line": "..." }
    ] }
```
`link` values are fixed: `forage, kitchen, cellar, board, sweet`. Each `line` is one or two
sentences, sourced, in that partner's voice, building on the dish. Implementation: orchestrate the
five personas (Silas is a Dose forager persona; the other four reuse the `harvest-ask` personas) in
one Anthropic call or a short chain, each line aware of the dish and ideally the prior link. Run
`houseTypography`. Answer `OPTIONS`; empty/missing dish is allowed (return a seasonal default).
The page also accepts `line` under the key `answer`, and will fall back to its built-in role lines
if `steps` is missing, so partial responses degrade gracefully.

---

## Build order
1. `harvest-ask.js`: validate `partner`, build the system prompt (persona + voice law + boundary),
   call Anthropic Haiku single-turn, run `houseTypography` on the output, return `{ answer }`.
   (Optional async: mint job, fire `harvest-background`, add `harvest-status`.)
2. CORS/OPTIONS + 400 on bad partner. `node --check` each file.
3. Vic only: bind `wine-data` (his built backpack) so cellar answers can look up real bottles.
   The other three stay prompt-only or `web-research` until `cheese-data`/`recipe-data`/
   `chocolate-data` land.
4. Phase 2: cross-agent pulls via `_agent-registry.js`; provision the three new partners through
   the Build Your Own shop, then crop their portraits into `RESTAURANT/assets` and deploy to the
   CDN (`/agents/Ruben_Hart_eyes_open.png`, `Camille_Lefevre_eyes_open.png`,
   `Luca_Brunner_eyes_open.png`) — the modal already points at those exact paths.

## Guardrails to keep
No em dashes (run `houseTypography`). Restaurant agents stay on flavor, craft, and provenance;
the Dose keeps the health desk. Every pairing names a reason. Advises, never certifies.
