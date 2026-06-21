# Deploy note for CC — 2026-06-20

The live site is running an older `index.html`. All the work below is in the local
`etl-lab-push/` working tree but **uncommitted**, so the last deploy did not include it. None of
this needs rebuilding. It needs commit + push + Netlify deploy.

## Git gotcha (do this first)
`restaurant.html` shows in git as **staged-deleted AND untracked at the same time** (`D restaurant.html`
plus `?? restaurant.html`). A plain `git commit -am` will commit the deletion and drop the new page.
Fix before committing:
```
cd etl-lab-push
git add restaurant.html
git status --short restaurant.html   # should read "A" or "M", not "D"
```
Then add the other new (untracked) files explicitly so they are not missed:
```
git add netlify/functions/gamma-image-ask.js netlify/functions/gamma-image-status.js \
        netlify/functions/voice-preview.js netlify/functions/harvest-ask.js \
        netlify/functions/harvest-circuit.js roster.json
git add agents/Ruben_Hart_eyes_open.png agents/Ruben_Hart_eyes_closed.png \
        agents/Camille_Lefevre_eyes_open.png agents/Camille_Lefevre_eyes_closed.png \
        agents/Luca_Brunner_eyes_open.png agents/Luca_Brunner_eyes_closed.png
git add CC-HANDOFF_restaurant_MASTER_2026-06-20.md CC-HANDOFF_harvest-ask_2026-06-20.md \
        CC-HANDOFF_agent-export_2026-06-20.md DEPLOY-NOTE_2026-06-20.md
```

## What changed since the last deploy (must ship)

**Homepage (`index.html`)**
- New grid card: **The Harvest Circuit** (`/restaurant`), Dining neighborhood (`#a8b54a`), n:8,
  travel note "3 native, 5 travel in".
- New grid card: **Take It With You** (`/export-your-agent`).
- New **Dining** legend chip (added to the `domains` array + `C`/`DOM` maps).
- Stat strip updated: **125** agents on staff, **30** travel between buildings, **20** live buildings.
  (Was 122 / 25 / 19. Reflects the 3 new restaurant natives + the 5 restaurant travelers + the
  restaurant as a live building. "Free on campus" left at 9 pending Dr. O's confirmation.)

**Restaurant (`restaurant.html`, NEW)**
- Full page: warm bio-tech theme, hero `/assets/harvest-circuit-hero.png`, two-sided front-of-house
  cards, and the **four menu modals** (Camille/Board, Ruben/Kitchen, Luca/Last Bite, Vic/Cellar).
- Modals POST to `/.netlify/functions/harvest-ask` (not built yet; modal shows a graceful
  placeholder until it lands). Spec: `CC-HANDOFF_harvest-ask_2026-06-20.md`.
- "Run the circuit" added to the circuit-of-the-meal section: an input that POSTs to
  `/.netlify/functions/harvest-circuit` and reveals the five links answering in sequence. Animated
  preview works now; real answers need the endpoint (spec in the harvest-ask handoff).
- Hero asset: `assets/harvest-circuit-hero.png` (confirm it is tracked/committed).

**Build Your Own Agent (`build-your-own-agent.html`)**
- Step 2 (Reach): "Other" fill-in to add a custom capability chip (slugified into the work order).
- Step 7 (Voice): "Other" fill-in to add a custom voice (single-select).
- Step 7 preview now uses **ElevenLabs Voice Design** (`/v1/text-to-voice/design`), not premade TTS.
  It generates a new voice from the description and returns the preview. **This must redeploy** for
  the live 404 to clear (the current live `voice-preview.js` is the old premade-TTS version).
  Voice Design consumes ElevenLabs credits per generate and takes a few seconds; the function
  returns `X-Generated-Voice-Id` so ETL can save the chosen voice on deploy. `voice-preview.js`
  still accepts an explicit `voice_id` to read with an existing My Voices voice.

**City chat (already in prior handoff, confirm shipped)**
- `city-government.html` + the 9 `city-{yolanda,priscilla,dez}-{ask,status,background}.js` functions.

**New backend functions (untracked, add + deploy)**
- `netlify/functions/gamma-image-ask.js`, `gamma-image-status.js` (Build Your Own portrait gen).
- `netlify/functions/voice-preview.js` (Build Your Own ElevenLabs Voice Design preview).
- `netlify/functions/harvest-ask.js` (the four menu-modal partners answer). Built, just deploy.
- `netlify/functions/harvest-circuit.js` (the "Run the circuit" relay gives real dish-specific
  sourced lines for all five links). Built, just deploy. Both use `_etl-voice-law.js` and the
  `ANTHROPIC_API_KEY` already in the env.

## Still pending (not blockers for this deploy)
- (done) `harvest-ask.js` and `harvest-circuit.js` are built; they answer once deployed.
- ~~The 3 new restaurant partner portraits~~ DONE: eyes-open + eyes-closed for Ruben, Camille,
  and Luca are now in `etl-lab-push/agents/` (and source in `RESTAURANT/assets/`). They ship as the
  PNGs added above; confirm they reach the CDN so the cards/modals show faces, not monograms.
- Ruben / Camille / Luca being built as full agents via the Build Your Own bench (campus 122 -> 125).

## Verify after deploy
1. `/` homepage shows the Harvest Circuit card under Dining and in the ranked grid (between the 9s
   and the Gym), the Take It With You card, the Dining legend chip, and the 125 / 30 / 20 stats.
2. `/restaurant` loads with the hero and four working "Talk to" modals.
3. `/build-your-own-agent` shows the Other fill-ins on steps 2 and 7.
