# Deploy note: city-services chat (2026-06-19)

Push `etl-lab-push` and let Netlify build. Ten files changed, all already validated
(`node --check` on every function and the inline page JS).

## Files (10)
New Netlify functions in `netlify/functions/`:
1. `city-yolanda-ask.js`
2. `city-yolanda-status.js`
3. `city-yolanda-background.js`
4. `city-priscilla-ask.js`
5. `city-priscilla-status.js`
6. `city-priscilla-background.js`
7. `city-dez-ask.js`
8. `city-dez-status.js`
9. `city-dez-background.js`

Edited pages:
10. `city-government.html` (chat CSS in `<style>`, a `.svc-chat` block in each of the three
    service cards, and one `<script>` before `</body>`)
11. `index.html` (home "campus" ranked grid: added a Government neighborhood + a City Government
    card linking `/city-government`, linked The Gym card to `/gym`, legend now seven chips).
    Verify the campus map iframe (`neighborhood.html`) also shows the Gym and City Government
    buildings; if not, that map file needs the same two added.
12. `office-loop.mp3` (new, site root). This is the live-stream audio bed; it just needs to be
    publicly reachable at `https://emerging-tech-lab.com/office-loop.mp3` so the stream droplet
    can `wget` it. Not referenced by any page; it is only a hosted file for the encoder.

## Deploy
From `etl-lab-push`: `git add -A && git commit -m "city services: Yolanda/Priscilla/Dez chat" && git push`.
Netlify auto-builds. No new dependencies (`@anthropic-ai/sdk` and `@netlify/blobs` are already
used by the existing functions).

## Notes
- The `*-background.js` names make those three run as Netlify background functions automatically,
  same as the Delia triplet. The ask function fires the background and returns a `job_id`; the page
  polls the matching status endpoint; the background writes the result to the `csuite_jobs` blob
  store under `<slug>/<job_id>`.
- Public by design: no Supabase auth on these (city services, no login wall).
- Model: `claude-haiku-4-5-20251001`. Env: reuses `ANTHROPIC_API_KEY` already in the Netlify
  environment. Nothing new to set.
- Portraits already serve from `/agents/` (the page's corridor wings use them), so no image step.

## Smoke test after deploy
Open `/city-government`, scroll to "Tell us what you need," click "Talk to Yolanda," ask
"what permits for a deck?" A response should stream into the panel within a few seconds. Repeat
for Priscilla and Dez.
