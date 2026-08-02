/* ─────────────────────────────────────────────────────────────────────────────
   _sherlock-conditions — real environmental data for the "Solve It With
   Sherlock" classroom. Two free, keyless, public sources, both for Dayton:

     sunrise-sunset.org      sunrise, sunset, and civil / nautical twilight for
                             any date and coordinate. This is the one that
                             matters. Case 02 turns entirely on whether a
                             witness could resolve a face at twenty five yards
                             at 5:40 p.m. on the 3rd of March, and that is not
                             a matter of opinion, it is a matter of where the
                             sun was.

     Iowa Environmental      the ASOS archive for KDAY, Dayton International.
     Mesonet                 Real observed cloud cover, visibility, wind, and
                             precipitation at the hour, going back decades.
                             What a defense attorney actually pulls.

   Why this exists. Everything else in this classroom is authored: I wrote the
   evidence, I wrote the witnesses, I decided who did it. This is the one part
   of the case a student can check against the world and that nobody, including
   the agents, can talk their way out of. It is the difference between reading
   about eyewitness reliability and proving a specific witness could not have
   seen what she says she saw.

   That is also why the case files no longer assert the light. They point at
   the record and make somebody go and look.

   Both sources are external, so both degrade the same way the Wikipedia
   backpack does: on failure the agent is told plainly that the lookup failed
   and instructed to say so rather than invent a number. A fabricated sunset
   time would be worse than no sunset time, because it would be checkable and
   wrong.

   Underscore prefix = utility module, not a Netlify endpoint.
   ───────────────────────────────────────────────────────────────────────────── */

// Dayton, Ohio. Used for the solar calculation; KDAY (Dayton International)
// is the reporting station for the observations.
const DAYTON = { lat: 39.7589, lng: -84.1916, tz: 'America/New_York', station: 'DAY' };

const FETCH_TIMEOUT_MS = 8000;
const UA = 'ETL-SolveItWithSherlock/1.0 (educational; emerging-tech-lab.com)';

/* Both services rate limit, and a group room fires three agent turns that all
   want the same date at the same instant, which is how a live test got two
   429s out of three. Two guards: one retry on a 429 or 5xx, and a module-level
   cache holding the WHOLE DAY's observations, so every time of day on a given
   date costs one fetch rather than one each.

   The caches hold the in-flight PROMISE, not the resolved value. Caching the
   value does nothing for the case that actually hurts: three agents firing
   simultaneously all miss the cache, all fetch, and two get rate limited.
   Holding the promise means the second and third callers await the first one's
   request instead of making their own. A rejected promise is evicted, so a
   transient failure is never remembered as the answer. */
const sunCache = new Map();   // date -> Promise<parsed sun object>
const obsCache = new Map();   // date -> Promise<raw CSV text>
const CACHE_CAP = 64;

function cached(map, key, produce) {
  const hit = map.get(key);
  if (hit) return hit;
  const p = produce().catch((err) => { map.delete(key); throw err; });
  if (map.size >= CACHE_CAP) map.delete(map.keys().next().value);
  map.set(key, p);
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok && (resp.status === 429 || resp.status >= 500) && attempt < 1) {
    await sleep(1200);
    return fetchWithTimeout(url, attempt + 1);
  }
  return resp;
}

function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function isTime(s) { return /^\d{2}:\d{2}$/.test(String(s || '')); }

// The solar API returns UTC instants. Everything a student reads should be in
// Dayton local time, or the whole exercise produces a five hour error and a
// confidently wrong answer.
function toLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DAYTON.tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/* ── Sun ──────────────────────────────────────────────────────────────────
   Civil twilight is the operative threshold for identification questions: it
   is roughly the point at which you can no longer make out detail outdoors
   without artificial light. Sunset is the number people quote; civil dusk is
   the number that decides the case. Both are returned. */
function fetchSun(date) {
  return cached(sunCache, date, () => fetchSunUncached(date));
}
async function fetchSunUncached(date) {
  const url = `https://api.sunrise-sunset.org/json?lat=${DAYTON.lat}&lng=${DAYTON.lng}&date=${encodeURIComponent(date)}&formatted=0`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`solar service returned ${r.status}`);
  const body = await r.json();
  if (!body || body.status !== 'OK' || !body.results) throw new Error('solar service returned no result');
  const x = body.results;
  return {
    sunrise: toLocal(x.sunrise),
    sunset: toLocal(x.sunset),
    civilDawn: toLocal(x.civil_twilight_begin),
    civilDusk: toLocal(x.civil_twilight_end),
    nauticalDusk: toLocal(x.nautical_twilight_end),
  };
}

/* ── Observed conditions ──────────────────────────────────────────────────
   The IEM archive serves plain CSV. Ask for the whole day and pick the
   observation nearest the time in question, rather than trusting the service
   to window it, because a missing hour should read as "the nearest report was
   forty minutes off" and not as silence. */
function parseCsvNearest(csv, targetDate, targetTime) {
  const lines = String(csv || '').trim().split('\n').filter((l) => l && !l.startsWith('#'));
  if (lines.length < 2) return null;
  const cols = lines[0].split(',').map((c) => c.trim());
  const idx = (name) => cols.indexOf(name);
  const iValid = idx('valid');
  if (iValid === -1) return null;

  const targetMinutes = Number(targetTime.slice(0, 2)) * 60 + Number(targetTime.slice(3, 5));
  let best = null, bestDelta = Infinity;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const valid = String(parts[iValid] || '').trim(); // "YYYY-MM-DD HH:MM"
    const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/.exec(valid);
    if (!m) continue;
    // Reports either side of midnight are still the same night, so allow the
    // previous and next day and fold the clock rather than discarding them.
    let minutes = Number(m[2]) * 60 + Number(m[3]);
    if (m[1] !== targetDate) minutes += (m[1] < targetDate ? -1440 : 1440);
    const delta = Math.abs(minutes - targetMinutes);
    if (delta < bestDelta) { bestDelta = delta; best = { parts, valid }; }
  }
  if (!best) return null;

  const get = (name) => {
    const i = idx(name);
    if (i === -1) return null;
    const v = String(best.parts[i] || '').trim();
    return (!v || v === 'M' || v === 'null') ? null : v;
  };
  return {
    observedAt: best.valid,
    minutesFromTarget: bestDelta,
    visibilityMiles: get('vsby'),
    skyCover: get('skyc1'),
    cloudBaseFt: get('skyl1'),
    tempF: get('tmpf'),
    windKt: get('sknt'),
    precipIn: get('p01i'),
    weatherCodes: get('wxcodes'),
  };
}

// METAR sky-cover abbreviations, spelled out. An agent quoting "OVC008" at a
// student is showing off, not teaching.
const SKY = {
  CLR: 'clear', SKC: 'clear', NCD: 'clear', NSC: 'no significant cloud',
  FEW: 'few clouds', SCT: 'scattered cloud', BKN: 'broken cloud', OVC: 'overcast', VV: 'sky obscured',
};

// One fetch per DATE, shared by every time of day and every concurrent caller.
async function fetchObserved(date, time) {
  const csv = await cached(obsCache, date, () => fetchDayCsv(date));
  const row = parseCsvNearest(csv, date, time);
  if (!row) throw new Error('no observation on record for that date');
  return row;
}

async function fetchDayCsv(date) {
  const [y, mo, d] = date.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo - 1, d + 1));
  const url = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py'
    + `?station=${DAYTON.station}`
    + '&data=tmpf&data=sknt&data=vsby&data=skyc1&data=skyl1&data=p01i&data=wxcodes'
    + `&year1=${y}&month1=${mo}&day1=${d}`
    + `&year2=${end.getUTCFullYear()}&month2=${end.getUTCMonth() + 1}&day2=${end.getUTCDate()}`
    + `&tz=${encodeURIComponent(DAYTON.tz)}&format=onlycomma&latlon=no&missing=M&trace=T&direct=no`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error(`observation archive returned ${r.status}`);
  const csv = await r.text();
  if (String(csv).trim().split('\n').filter((l) => l && !l.startsWith('#')).length < 2) {
    throw new Error('no observations on record for that date');
  }
  return csv;
}

/* ── The formatted answer handed back to an agent ─────────────────────────
   Written as a briefing, not a data dump, and it deliberately states which
   parts are the record and which are inference, because the agents are about
   to argue in front of a student who is being graded on exactly that
   distinction. */
function format(date, time, sun, obs, sunError, obsError) {
  const out = [`CONDITIONS OF RECORD, Dayton, Ohio, ${date} at ${time} local.`];

  if (sun) {
    out.push(
      `Sun: sunrise ${sun.sunrise}, sunset ${sun.sunset}. Civil twilight ran from ${sun.civilDawn} to ${sun.civilDusk}; nautical twilight ended ${sun.nauticalDusk}.`,
      'Civil dusk is the threshold that matters for whether a person can make out detail outdoors without artificial light. After it, unaided identification at distance is not reliable.'
    );
  } else {
    out.push(`Sun: lookup failed (${sunError}). Do not state a sunset or twilight time. Say plainly that you could not verify it.`);
  }

  if (obs) {
    const sky = obs.skyCover ? (SKY[obs.skyCover] || obs.skyCover) : null;
    const bits = [];
    if (sky) bits.push('sky ' + sky + (obs.cloudBaseFt ? ` at ${obs.cloudBaseFt} feet` : ''));
    if (obs.visibilityMiles) bits.push(`visibility ${obs.visibilityMiles} statute miles`);
    if (obs.tempF) bits.push(`${obs.tempF} degrees`);
    if (obs.windKt) bits.push(`wind ${obs.windKt} knots`);
    if (obs.precipIn && obs.precipIn !== '0.00') bits.push(`precipitation ${obs.precipIn} inches in the hour`);
    if (obs.weatherCodes) bits.push(`present weather ${obs.weatherCodes}`);
    out.push(`Observed at Dayton International, reported ${obs.observedAt}${obs.minutesFromTarget > 15 ? ` (the nearest report, ${obs.minutesFromTarget} minutes off)` : ''}: ${bits.join(', ') || 'no usable elements in that report'}.`);
  } else {
    out.push(`Observed conditions: lookup failed (${obsError}). Do not state a cloud cover or visibility. Say plainly that you could not verify it.`);
  }

  out.push(
    'This is the real public record for that date and place, not part of the case file. Treat it as evidence: it constrains what a witness could have seen, it does not tell you what happened. Describe it in your own words and do not name the service you got it from.'
  );
  return out.join('\n');
}

/* Never throws. A half answer is useful; a thrown error inside an agent turn
   just loses the turn. Each source fails independently. */
async function getConditions(date, time) {
  if (!isDate(date)) return 'Invalid date. Use YYYY-MM-DD.';
  if (!isTime(time)) return 'Invalid time. Use HH:MM on a 24 hour clock.';

  const [sunRes, obsRes] = await Promise.allSettled([fetchSun(date), fetchObserved(date, time)]);
  const sun = sunRes.status === 'fulfilled' ? sunRes.value : null;
  const obs = obsRes.status === 'fulfilled' ? obsRes.value : null;
  const sunError = sunRes.status === 'rejected' ? String(sunRes.reason && sunRes.reason.message || sunRes.reason) : null;
  const obsError = obsRes.status === 'rejected' ? String(obsRes.reason && obsRes.reason.message || obsRes.reason) : null;

  if (!sun && !obs) {
    return `Could not reach either record for ${date} at ${time} (${sunError}; ${obsError}). Say plainly that you could not verify the conditions, and do not state a time or a sky condition you have not checked.`;
  }
  return format(date, time, sun, obs, sunError, obsError);
}

module.exports = { DAYTON, getConditions, fetchSun, fetchObserved, parseCsvNearest };
