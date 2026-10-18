/* _sun: what sun-morning.js and sun-settings.js share, 2026-10-18. The device key check, the saved settings, and the fairies.

   Settings live in one record in the 'rising_sun' blob store. The calendar link is private (anyone holding it can read the calendar): it is kept here, never sent
   back to the page or the board, and the panel only learns that one is set. Same rule as AL's calendar.json. */
const KEY_HEADER = 'x-sun-key';

function authorized(event, env) {
  const want = (env || process.env).SUN_DEVICE_KEY;
  if (!want) return { ok: false, code: 503, error: 'no_device_key_set' };
  const h = event.headers || {};
  const got = h[KEY_HEADER] || h['X-Sun-Key'] || '';
  return got === want ? { ok: true } : { ok: false, code: 401, error: 'wrong_key' };
}

const ZONES = {
  eastern: 'EST5EDT,M3.2.0,M11.1.0', central: 'CST6CDT,M3.2.0,M11.1.0', mountain: 'MST7MDT,M3.2.0,M11.1.0',
  arizona: 'MST7', pacific: 'PST8PDT,M3.2.0,M11.1.0', alaska: 'AKST9AKDT,M3.2.0,M11.1.0', hawaii: 'HST10',
};
const DEFAULTS = { wake_hour: 7, wake_min: 0, sunrise_minutes: 30, zone: 'eastern', fairy: 'default', fairies: {} };

function str(v, max) { return typeof v === 'string' ? v.replace(/[\u2013\u2014]/g, ',').trim().slice(0, max) : ''; }
function int(v, lo, hi) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; }
const VOICE_RE = /^(azure:[A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z0-9]{3,60}|[A-Za-z0-9]{12,30})$/;
const ID_RE = /^[a-z0-9-]{1,30}$/;

/* A patch from the panel becomes only the fields it may change, each checked. Anything else is dropped. */
function cleanPatch(body) {
  const out = {};
  const a = int(body.wake_hour, 0, 23); if (a !== null) out.wake_hour = a;
  const b = int(body.wake_min, 0, 59); if (b !== null) out.wake_min = b;
  const c = int(body.sunrise_minutes, 5, 90); if (c !== null) out.sunrise_minutes = c;
  if (ZONES[body.zone]) out.zone = body.zone;
  if (typeof body.fairy === 'string' && ID_RE.test(body.fairy)) out.fairy = body.fairy;
  if (typeof body.calendar_url === 'string') {
    let u = body.calendar_url.trim();
    if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice(9);
    if (u === '' || /^https:\/\/\S{4,1500}$/.test(u)) out.calendar_url = u;
  }
  if (body.fairies && typeof body.fairies === 'object') {
    out.fairies = {};
    for (const id of Object.keys(body.fairies).slice(0, 12)) {
      if (!ID_RE.test(id)) continue;
      const f = body.fairies[id] || {};
      const o = { name: str(f.name, 60), greeting: str(f.greeting, 300), ask: str(f.ask, 300), manner: str(f.manner, 300), backstory: str(f.backstory, 3000) };
      if (typeof f.voice === 'string' && VOICE_RE.test(f.voice.trim())) o.voice = f.voice.trim();
      out.fairies[id] = o;
    }
  }
  return out;
}

/* delete_fairy removes a fairy the owner made. The two that ship cannot be removed, only changed. */
function applyPatch(current, body) {
  const next = Object.assign({}, DEFAULTS, current || {});
  const p = cleanPatch(body);
  const fairies = Object.assign({}, next.fairies);
  if (p.fairies) for (const id of Object.keys(p.fairies)) fairies[id] = Object.assign({}, fairies[id], p.fairies[id]);
  if (typeof body.delete_fairy === 'string' && !['default', 'arrogant'].includes(body.delete_fairy)) delete fairies[body.delete_fairy];
  delete p.fairies;
  const merged = Object.assign(next, p, { fairies });
  if (merged.fairy !== 'default' && merged.fairy !== 'arrogant' && !fairies[merged.fairy]) merged.fairy = 'default';
  return merged;
}

/* What the page and the board may see: everything except the calendar link itself. */
function publicView(s) {
  const o = Object.assign({}, DEFAULTS, s || {});
  const calendar_set = !!o.calendar_url;
  delete o.calendar_url;
  return Object.assign(o, { calendar_set, tz: ZONES[o.zone] || ZONES.eastern });
}

/* The shipped fairies with the owner's changes laid over them. */
function mergePersonas(base, settings) {
  const out = JSON.parse(JSON.stringify(base || {}));
  const f = (settings && settings.fairies) || {};
  for (const id of Object.keys(f)) {
    const mine = {};
    for (const k of Object.keys(f[id])) if (f[id][k]) mine[k] = f[id][k];
    out[id] = Object.assign({}, out[id], mine);
  }
  if (settings && settings.fairy) out.chosen = settings.fairy;
  return out;
}

async function openStore(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { connectLambda(event); } catch (_) {}
  return getStore('rising_sun');
}
async function loadSettings(store) { return (await store.get('settings', { type: 'json' })) || {}; }
async function saveSettings(store, s) { await store.setJSON('settings', s); }

/* Above the Fold, ETL Newswire's daily multi-voice briefing. newswire-briefing-background.js saves its details under newswire_briefings_meta/latest and the mp3 is served
   by newswire-briefing-audio. Dr. O, 2026-10-18: "the news briefing can be from above the fold". Returns null when there is none. */
const SITE_BASE = 'https://emerging-tech-lab.com';
async function loadNews(event, deps = {}) {
  let meta;
  if (deps.loadMeta) meta = await deps.loadMeta();
  else {
    const { getStore, connectLambda } = require('@netlify/blobs');
    try { connectLambda(event); } catch (_) {}
    meta = await getStore('newswire_briefings_meta').get('latest', { type: 'json' });
  }
  if (!meta || !meta.audio_url) return null;
  const when = new Date(meta.generated_at);
  const hours = isNaN(+when) ? null : ((deps.now || Date.now()) - +when) / 3600000;
  return {
    audio_url: SITE_BASE + meta.audio_url,
    generated_at: meta.generated_at || null,
    hours_old: hours,
    duration_label: meta.duration_label || '',
    headlines: (meta.pieces || []).map((x) => String(x.title || '').trim()).filter(Boolean).slice(0, 8),
  };
}

module.exports = { loadNews, authorized, cleanPatch, applyPatch, publicView, mergePersonas, openStore, loadSettings, saveSettings, ZONES, DEFAULTS };
