/* story-record-background: records one written story as an mp3, on the site, with the site's own ElevenLabs key (no new key needed), 2026-11-01.
   Dr. O: "you can make the episodes in Reggie, Biscuit, Mochi's voice", and the site cannot take another key, so it is recorded here and kept in the site's
   own store (Netlify Blobs, 'box_stories'), not in the repository.

   POST {series:'reggie-biscuit-mochi', episode:'trash'}   header x-sun-key (the home access code the panel already has)
   A "-background" function answers 202 at once and carries on for up to 15 minutes. Progress is kept at status-<series>-<episode>, which story-audio.js reports.
   It voices each beat in its own character's voice (Reggie, Biscuit, Mochi), joins the pieces, and stores ep-<series>-<episode>_v<n>.mp3.
   One story costs roughly a few cents of ElevenLabs characters. It will not record a story that is already recorded unless asked again ({again:true}, which
   keeps the old one and makes the next _v). It will not start a second recording of the same story while one is running.
   The three dogs' stories (pack-episodes.json), Nora's and Cressida's (rising-sun/box-stories.json), A.L.I.C.E.'s saga and the fairies' Human Summer (fragments, only the tellers who have a voice) and Kit's three field notes (Azure for Kit, ElevenLabs for Tilly's quoted lines) are all done here.
   NOT TRIED against the real ElevenLabs service: it needs Dr. O to press it, because every recording spends ElevenLabs credit. 64 kbps mp3, so a five minute story stays
   under the 6 MB a function may send back. The pieces are joined end to end with no added pause. */
const sun = require('./_sun.js');
const plan = require('./_story-plan.js');

let PACK = { episodes: [] };
try { PACK = require('../../pack-episodes.json'); } catch (_) {}
let STORIES = { series: [] };      // rising-sun/box-stories.json: Nora's adventures and Cressida's observations, approved by Dr. O
try { STORIES = require('../../rising-sun/box-stories.json'); } catch (_) {}
let ALICE = { fragments: [] }, FAIRY = { fragments: [] }, EXPLORER = { episodes: [] };       // A.L.I.C.E.'s saga, the fairies' Human Summer, Kit's field notes
try { ALICE = require('../../alice-fragments.json'); } catch (_) {}
try { FAIRY = require('../../fairy-fragments.json'); } catch (_) {}
try { EXPLORER = require('../../explorer-episodes.json'); } catch (_) {}
const { azureVoiceName, azureSpeak } = require('./_azure-tts.js');

const MODEL = 'eleven_turbo_v2_5';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true };
/* What there is to record, per series: the episodes (id, and a function that returns the voiced parts and the parts skipped for want of a voice).
   The three dogs and Nora and Cressida are written as beats; A.L.I.C.E.'s saga and the fairies' Human Summer are collections of short fragments told by several voices
   (a teller with no voice yet is left out and reported, never guessed); Kit's are three short field notes in an Azure voice, with Tilly's quoted lines in hers. */
function sources(deps) {
  const out = {};
  const pack = (deps.pack || PACK).episodes || [];
  out['reggie-biscuit-mochi'] = pack.map((e) => ({ id: e.id, parts: () => ({ parts: plan.plan(e), skipped: [] }) }));
  ((deps.stories || STORIES).series || []).forEach((x) => { out[x.id] = (x.episodes || []).map((e) => ({ id: e.id, parts: () => ({ parts: plan.plan(e), skipped: [] }) })); });
  out.alice = [{ id: 'alice-saga', parts: () => plan.planFragments(deps.alice || ALICE) }];
  out.tansy = [{ id: 'tansy-human-summer', parts: () => plan.planFragments(deps.fairy || FAIRY) }];
  out.kit = ((deps.explorer || EXPLORER).episodes || []).map((e) => ({ id: 'kit-' + e.id, parts: () => plan.kitParts(e) }));
  return out;
}
/* The episodes that have something written, for the panel: { series: [ids] } */
function writtenMap(deps = {}) {
  const m = {}; const src = sources(deps);
  Object.keys(src).forEach((k) => { m[k] = src[k].map((e) => e.id); });
  return m;
}

async function speak(key, voiceId, text, fetchFn = fetch, format = 'mp3_44100_64') {
  const r = await fetchFn('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=' + encodeURIComponent(format), {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: String(text).slice(0, 2500), model_id: MODEL, voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new Error('eleven_' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

/* One part, in whichever service its voice belongs to: an id that starts with azure: is spoken by Azure (Kit), anything else by ElevenLabs. */
async function speakAny(key, voiceId, text, fetchFn, event, deps, format) {
  if (String(voiceId).indexOf('azure:') === 0) {
    const name = azureVoiceName(voiceId);
    if (!name) throw new Error('bad_azure_voice');
    const env = (deps && deps.azureEnv) || await require('./_gc-config.js').azureEnv(event);
    return azureSpeak(text, name, { env, fetchFn: fetchFn || fetch });
  }
  return speak(key, voiceId, text, fetchFn, format || undefined);
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
  const src = sources(deps)[series];
  if (!src) { await noteError(store, 'series_not_recordable_here', series, episode, deps); return { statusCode: 404, body: 'series_not_recordable_here' }; }
  const ep = src.find((e) => e.id === episode);
  if (!ep) { await noteError(store, 'unknown_episode', series, episode, deps); return { statusCode: 404, body: 'unknown_episode' }; }
  const planned = ep.parts();
  if (!planned.parts.length) { await noteError(store, 'no_voices', series, episode, deps); return { statusCode: 409, body: 'no_voices' }; }
  const env = deps.env || process.env;
  const key = String(env.ELEVENLABS_API_KEY || '').trim();
  if (planned.parts.some((p) => String(p.voice || plan.VOICES[p.who]).indexOf('azure:') !== 0) && !key) { await noteError(store, 'no_eleven_key', series, episode, deps); return { statusCode: 503, body: 'no_eleven_key' }; }

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

  const parts = planned.parts;
  let done = resume ? st.done : 0;
  const pk = (i) => 'part-' + series + '-' + episode + '-v' + version + '-' + i;
  if (!resume) await store.setJSON(sk, { state: 'recording', done: 0, total: parts.length, version, at: now });
  /* The recording is done a few seconds' worth at a time. If the site stops a background job after a short time limit (which would look exactly like a recording that
     starts and stops part way), the job starts a fresh copy of itself for the rest, so it is carried through either way. Each finished part is kept, so nothing is redone. */
  const budget = deps.budgetMs !== undefined ? deps.budgetMs : 8000, t0 = Date.now();
  try {
    while (done < parts.length) {
      const buf = await (deps.speak || ((k, v, t, f, fmt) => speakAny(k, v, t, f, event, deps, fmt)))(key, parts[done].voice || plan.VOICES[parts[done].who], parts[done].text, deps.fetchFn, parts[done].format);
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
    idx2.skipped = idx2.skipped || {}; if (planned.skipped.length) idx2.skipped[id] = { n: planned.skipped.length, who: Array.from(new Set(planned.skipped.map((x) => x.who))) }; else delete idx2.skipped[id];
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
exports.writtenMap = writtenMap;
