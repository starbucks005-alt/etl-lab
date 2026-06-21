# CC Handoff (MASTER): The Harvest Circuit at ETL — restaurant + menu modals — 2026-06-20

Everything CC needs to build, verify, and deploy the first-floor restaurant and its four
interactive menu modals. The page and modals are already authored in `etl-lab-push/restaurant.html`;
this doc is the single source of truth so CC can finish the backend, ship the portraits, wire the
grid card, and deploy. House voice everywhere: **no em dashes**, every pairing/claim names a
reason or source, agents advise and never certify, the Dose keeps the health desk.

---

## 0. What exists vs what CC must do

**Already built (in `etl-lab-push/`, ship as-is):**
- `restaurant.html` — full page (warm bio-tech theme, hero, concept, circuit-of-the-meal,
  two-sided front-of-house cards, "also in the house" chips) + the four menu modals (UI + JS).
- `assets/harvest-circuit-hero.png` — the hero image (page points at `/assets/harvest-circuit-hero.png`).
- Home grid card "The Harvest Circuit" already added to `index.html` (Dining neighborhood,
  color `#a8b54a`, links to `/restaurant`). Verify it renders.

**CC to build:**
1. `harvest-ask.js` backend so the modal Ask boxes answer (full spec in
   `CC-HANDOFF_harvest-ask_2026-06-20.md`, summarized in section 5 below).
2. Crop + deploy the three new partner portraits to the CDN (section 6).
3. The three new partners' backpack specs (`recipe-data`, `cheese-data`, `chocolate-data`),
   or fall back to `web-research` for v1 (section 5).
4. Deploy and smoke-test (section 7).

---

## 1. Concept and name

**The Harvest Circuit at ETL.** First floor of the Emerging Technologies Laboratory: a modern
farm-to-table house with a 2030s-Jetsons look (warm wood and live greenery against clean
high-tech lines, the campus dark-cyan glow softened for a dining room). One obsession: knowing
where everything comes from, which is the campus rule (verify before you believe) served on a
plate. "Harvest" = the farm-to-table soul (foraging, seasonal menu, provenance). "Circuit" = the
2030s tech and the circuit of the meal itself, from Silas's basket through the pass, the cellar,
the cheese board, to Luca's last bite.

**Value lane (does not touch the Dose):** visitors come to learn pairings and sourcing (which wine
sings with which dish, what cheese sits next to it, how flavors fit, where every ingredient comes
from). The Dose is the health and verify desk and covers none of that. Zero overlap.

Full cast detail: `RESTAURANT/restaurant-cast-bible_2026-06-20.md`.

---

## 2. The collective (8 partners, owner-operators)

Five campus regulars who took a second home here, three new restaurant-native faces.

| Who | Role at the restaurant | Home | Backpack |
|---|---|---|---|
| **Vic Stallion** (Dr. Vikram Sethi) | Sommelier / cellar (front of house) | ETL platform | `wine-data` (built) |
| **Wyatt E. Cooper** | Bar: spirits + zero-proof shelf | The Dose | in-framework; shares `wine-data` |
| **Silas Hill** | Forager: wild ingredients + safety gate | The Dose | `plant-id` (built) |
| **Amara Nwosu** | Botanicals, tea, apothecary cocktails | The Dose | `supplement-safety`, `lit-pubmed` |
| **Nadia Hassan** | Menu balance and flavor (not diet) | The Dose | `nutrition-data`, `lit-pubmed` |
| **Ruben Hart** (NEW, American) | Chef: kitchen lead, technique, seasonal menu | Restaurant-native | `recipe-data` (new) or `web-research` |
| **Camille Lefèvre** (NEW, French) | Cheese monger: cheese, charcuterie, provenance | Restaurant-native | `cheese-data` (new) or `web-research` |
| **Luca Brunner** (NEW, Swiss) | Chocolatier: bean-to-bar desserts, pairing | Restaurant-native | `chocolate-data` (new) or `web-research` |

**Front of house = the four with menu modals: Ruben, Vic, Camille, Luca.** The other four appear
as "also in the house" chips linking to thedose.net.

---

## 3. Page spec (already built; reference for verify/rebuild)

`restaurant.html`, single self-contained file. Theme tokens (warm bio-tech):
`--bg #140f08`, `--amber #e8b659`, `--teal #46d6e6`, `--vein #f0c14b`; fonts Spectral (display),
Inter (body), IBM Plex Mono (labels). Sections in order:
1. Hero: `<img src="/assets/harvest-circuit-hero.png">` + SVG root-vein motif, name + tagline.
2. Concept paragraph (farm to table + provenance + the campus rule).
3. "The circuit of the meal" flow (basket -> pass -> cellar -> board -> last bite).
4. **Front of house, two sides** (`.sides` grid):
   - Left "The plate & the pour" = **Ruben** (chef, new) + **Vic** (sommelier).
   - Right "The board & the sweet" = **Camille** (cheese, new) + **Luca** (chocolate, new).
   - Each card: `.av av-lg` avatar (monogram `<i>` + `<img onerror="this.remove()">`), name,
     role, one-line bio, and a `<button class="talk" data-name="Ruben|Vic|Camille|Luca">`.
5. "Also in the house": Wyatt, Silas, Amara, Nadia chips -> thedose.net.
6. Verify note (house stoplight brand) + footer.

Avatar image paths the page expects (CDN): `/agents/Ruben_Hart_eyes_open.png`,
`/agents/Vic_Stallion_eyes_open.png` (live), `/agents/Camille_Lefevre_eyes_open.png`,
`/agents/Luca_Brunner_eyes_open.png`. Monogram shows until the image loads (graceful `onerror`).

---

## 4. Menu modals spec (already built; this is the contract)

Each `.talk` button opens that partner's modal (`openModal(key)` where key = lowercase of
`data-name`: ruben, vic, camille, luca). Unified structure, per "The Harvest Circuit.docx":
- **Header:** portrait (`av-sm`) + name + role + small icon (🔪 chef, 🍷 wine, 🧀 cheese, 🍫 chocolate) + close.
- **Intro:** 2-3 sentence welcome ("You are in The Kitchen. I am Ruben...").
- **Sample-question chips (3-4):** click auto-fills the input.
- **Ask row:** text input + Ask button (Enter also submits).
- **Response area:** fade-in, holds the agent's answer.
- **Footer:** "Powered by The Harvest Circuit" + "Ask another" quick-links to the other three.

The per-partner intro text and sample chips are already in the `HC` object in `restaurant.html`
(ruben/vic/camille/luca). The four stations map to: The Kitchen (Ruben), The Cellar (Vic),
The Board (Camille), The Last Bite (Luca).

**The Ask contract the page already sends:**
```
POST /.netlify/functions/harvest-ask
{ "partner": "ruben"|"vic"|"camille"|"luca", "question": "..." }
```
The modal renders `d.answer` (or `d.response`). Until the function exists it shows a graceful
"still settling into the kitchen" message, so the page is safe to ship now.

---

## 5. Backend: `harvest-ask` (full spec in `CC-HANDOFF_harvest-ask_2026-06-20.md`)

Mirror the public city chat triplet (`city-yolanda-ask/status/background.js`) + Netlify Blobs
(`getStore('csuite_jobs')`). Public, no Supabase auth (free in-house agents). Model
`claude-haiku-4-5-20251001`. **Sync `{ answer }` response needs zero page changes** (recommended
for v1). System prompt per partner = persona (from the cast bible) + house voice law + lane
boundary (flavor/craft/provenance only). Personas, in brief:
- **ruben** — chef, American. Warm, decisive, "let the carrot be a carrot." Methods, ingredients, timing.
- **vic** — sommelier (Dr. Vikram Sethi). Calm, precise. Wine structure, tannins, pairing; defaults
  to Super Tuscans for a favorite. **Only partner with a real backpack (`wine-data`, built)** — wire
  it if you go async; prompt-only is fine for v1.
- **camille** — cheese monger, French. Elegant, exacting. Milk, region, age, rind, pairing.
- **luca** — chocolatier, Swiss. Precise, calm. Chocolate, tempering, dessert structure.
Phase 2: cross-agent data pulls (Camille<-Silas/Amara, Ruben<-Silas/Amara/Wyatt/Nadia,
Luca<-Vic/Camille/Silas, Vic<-Silas/Ruben/Camille/Luca) via the shared `_agent-registry.js`
resolver proposed in `CC-HANDOFF_agent-export_2026-06-20.md`. Reuse it, do not fork.

Run `houseTypography` on every output (no em dashes). Answer `OPTIONS`; 400 on unknown partner.

---

## 6. Portraits to crop + deploy

Crop the three new partners from `RESTAURANT/harvest-circuit-hero.png` (the group portrait),
make eyes-open + eyes-closed pairs, save to **`RESTAURANT/assets`** per the house per-site rule,
then deploy to the CDN so the page picks them up:
- `Ruben_Hart_eyes_open.png` -> `/agents/Ruben_Hart_eyes_open.png`
- `Camille_Lefevre_eyes_open.png` -> `/agents/Camille_Lefevre_eyes_open.png`
- `Luca_Brunner_eyes_open.png` -> `/agents/Luca_Brunner_eyes_open.png`
Vic already has `/agents/Vic_Stallion_eyes_open.png` (his files use the `Vic_Stallion_*` nickname;
map `Vic_Stallion` -> Dr. Vikram Sethi). The page degrades to a monogram until these land.

Once the three new portraits exist, add the three new partners to the master roster + image
catalog (campus goes from 122 toward 125 if they become full roster agents; confirm with Dr. O
whether they are roster agents or page-only personas before changing the canonical 122 count).

---

## 7. Deploy checklist
1. Ship `restaurant.html`, `assets/harvest-circuit-hero.png`, and the `index.html` grid-card edit.
2. Smoke test `/restaurant`: hero loads, four cards render, each "Talk to" opens the right modal,
   chips auto-fill, footer quick-links switch partners, Ask shows the graceful placeholder.
3. Add `harvest-ask.js` (sync `{answer}`); re-test Ask returns a real answer for all four.
4. Bind Vic's `wine-data`; ship the three new portraits; re-test avatars.
5. Phase 2: the three new backpacks + cross-agent pulls; provision the new partners via the
   Build Your Own shop.

## 8. Guardrails to keep
No em dashes (`houseTypography`). Restaurant agents stay on flavor, craft, and provenance; the
Dose owns health. Every pairing names a reason. Advises, never certifies.

## Related handoffs
- `CC-HANDOFF_harvest-ask_2026-06-20.md` — the backend in full.
- `CC-HANDOFF_agent-export_2026-06-20.md` — the `_agent-registry.js` resolver to reuse.
- `RESTAURANT/restaurant-cast-bible_2026-06-20.md` — full personas, feuds, origin story.
