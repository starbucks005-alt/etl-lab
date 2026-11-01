/* story-record-background: records one written story as an mp3, on the site, with the site's own ElevenLabs key (no new key needed), 2026-11-01.
   Dr. O: "you can make the episodes in Reggie, Biscuit, Mochi's voice", and the site cannot take another key, so it is recorded here and kept in the site's
   own store (Netlify Blobs, 'box_stories'), not in the repository.

   POST {series:'reggie-biscuit-mochi', episode:'trash'}   header x-sun-key (the home access code the panel already has)
   A "-background" function answers 202 at once and carries on for up to 15 minutes. Progress is kept at status-<series>-<episode>, which story-audio.js reports.
   It voices each beat in its own character's voice (Reggie, Biscuit, Mochi), joins the pieces, and stores ep-<series>-<episode>_v<n>.mp3.
   One story costs roughly a few cents of ElevenLabs characters. It will not record a story that is already recorded unless asked again ({again:true}, which
   keeps the old one and makes the next _v). It will not start a second recording of the same story while one is running.
   The three dogs' stories (pack-episodes.json) and Nora's and Cressida's (rising-sun/box-stories.json) are done here. Tansy's fragments and Kit's stories are not.
   NOT TRIED against the real ElevenLabs service: it needs Dr. O to press it, because every recording spends ElevenLabs credit. 64 kbps mp3, so a five minute story stays
   under the 6 MB a function may send back. The pieces are joined end to end with no added pause. */
const sun = require('./_sun.js');
const plan = require('./_story-plan.js');

let PACK = { episodes: [] };
try { PACK = require('../../pack-episodes.json'); } catch (_) {}
let STORIES = { series: [] };      // rising-sun/box-stories.json: Nora's adventures and Cressida's observations, approved by Dr. O
try { STORIES = require('../../rising-sun/box-stories.json'); } catch (_) {}

const MODEL = 'eleven_turbo_v2_5';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true };
/* The written episodes of one series: the three dogs' stories come from pack-episodes.json, the others from rising-sun/box-stories.json. */
function episodesOf(series, deps) {
  if (series === 'reggie-biscuit-mochi') return (deps.pack || PACK).episodes || [];
  const sr = ((deps.stories || STORIES).series || []).find((x) => x.id === series);
  return sr ? sr.episodes || [] : null;
}

async function speak(key, voiceId, text, fetchFn = fetch) {
  const r = await fetchFn('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3_44100_64', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: String(text).slice(0, 2500), model_id: MODEL, voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new Error('eleven_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('box_stories');
}

/* A background function always answers 202 at once, so a refusal or a failure inside is invisible to the panel. Each one is written here so story-audio can say what happened. */
async function noteError(store, error, series, episode, deps) {
  try { await store.setJSON('last-error', { error: String(error).slice(0, 60), series: String(series || ''), episode: String(episode || ''), at: deps.now ? deps.now() : Date.now() }); } catch (_) {}
}

exports.handler = async (event, deps = {}) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'post_only' };
  const a = await sun.authorized(event, deps.env, deps.loadCfg);
  if (!a.ok) return { statusCode: a.code, body: a.error };
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return { statusCode: 400, body: 'bad_json' }; }
  const series = String(body.series || ''), episode = String(body.episode || '');
  const store = deps.store || await openStore(event);
  const list = episodesOf(series, deps);
  if (!list) { await noteError(store, 'series_not_recordable_here', series, episode, deps); return { statusCode: 404, body: 'series_not_recordable_here' }; }
  const ep = list.find((e) => e.id === episode);
  if (!ep) { await noteError(store, 'unknown_episode', series, episode, deps); return { statusCode: 404, body: 'unknown_episode' }; }
  const env = deps.env || process.env;
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (!key) { await noteError(store, 'no_eleven_key', series, episode, deps); return { statusCode: 503, body: 'no_eleven_key' }; }

  const now = deps.now ? deps.now() : Date.now();
  const sk = 'status-' + series + '-' + episode;
  let st = null; try { st = await store.get(sk, { type: 'json' }); } catch (_) {}
  const resume = !!body.resume && st && st.state === 'recording' && st.version === body.version;     // the job carrying itself on after a stop, see below
  if (!resume && st && st.state === 'recording' && now - st.at < 4 * 60 * 1000) { await noteError(store, 'already_recording', series, episode, deps); return { statusCode: 409, body: 'already_recording' }; }   // a recording that has made no progress for four minutes is taken to have died
  let idx = { ids: {} }; try { idx = (await store.get('index', { type: 'json' })) || idx; } catch (_) {}
  const id = series + '/' + episode;
  const have = idx.ids[id] || 0;
  if (!resume && have && !body.again) { await noteError(store, 'already_recorded', series, episode, deps); return { statusCode: 409, body: 'already_recorded' }; }
  const version = resume ? st.version : have + 1;

  const parts = plan.plan(ep);
  let done = resume ? st.done : 0;
  const pk = (i) => 'part-' + series + '-' + episode + '-v' + version + '-' + i;
  if (!resume) await store.setJSON(sk, { state: 'recording', done: 0, total: parts.length, version, at: now });
  /* The recording is done a few seconds' worth at a time. If the site stops a background job after a short time limit (which would look exactly like a recording that
     starts and stops part way), the job starts a fresh copy of itself for the rest, so it is carried through either way. Each finished part is kept, so nothing is redone. */
  const budget = deps.budgetMs !== undefined ? deps.budgetMs : 8000, t0 = Date.now();
  try {
    while (done < parts.length) {
      const buf = await (deps.speak || speak)(key, plan.VOICES[parts[done].who], parts[done].text, deps.fetchFn);
      await store.set(pk(done), buf);
      done++;
      await store.setJSON(sk, { state: 'recording', done, total: parts.length, version, at: deps.now ? deps.now() : Date.now() });
      if (done < parts.length && Date.now() - t0 >= budget) {
        await (deps.selfCall || selfCall)(event, { series, episode, version });
        return { statusCode: 202, body: '' };
      }
    }
    const bufs = [];
    for (let i = 0; i < parts.length; i++) bufs.push(Buffer.from(await store.get(pk(i), { type: 'arrayBuffer' })));
    const mp3 = Buffer.concat(bufs);
    await store.set('ep-' + series + '-' + episode + '_v' + version, mp3);
    let idx2 = { ids: {} }; try { idx2 = (await store.get('index', { type: 'json' })) || idx2; } catch (_) {}
    idx2.ids[id] = version;
    await store.setJSON('index', idx2);
    await store.setJSON(sk, { state: 'done', done: parts.length, total: parts.length, version, bytes: mp3.length, at: deps.now ? deps.now() : Date.now() });
    for (let i = 0; i < parts.length; i++) { try { if (store.delete) await store.delete(pk(i)); } catch (_) {} }
    return { statusCode: 202, body: '' };
  } catch (e) {
    await store.setJSON(sk, { state: 'failed', error: String((e && e.message) || e).slice(0, 80), at: deps.now ? deps.now() : Date.now() });
    await noteError(store, (e && e.message) || e, series, episode, deps);
    return { statusCode: 202, body: '' };
  }
};

/* Starts a fresh copy of this job to carry on from the stored parts. It answers 202 at once, like every background job, so waiting for it costs nothing. */
async function selfCall(event, payload, fetchFn = fetch) {
  const h = event.headers || {};
  const base = process.env.URL || (h.host ? 'https://' + h.host : 'https://emerging-tech-lab.com');
  await fetchFn(base + '/.netlify/functions/story-record-background', { method: 'POST', headers: { 'x-sun-key': h['x-sun-key'] || '', 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ resume: true }, payload)) });
}
exports.speak = speak;
