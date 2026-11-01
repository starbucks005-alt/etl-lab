/* _story-plan: how a written story (pack-episodes.json) becomes the parts to be voiced, one part per beat, each in its own character's voice.
   Shared by tools/record-pack-stories.js (run on a computer) and netlify/functions/story-record-background.js (run on the site, with the site's own
   ElevenLabs key), so the two can never read a story differently. */
const VOICES = {
  reggie: 'uq0HIbNZKn11Hs5ifEdd',
  biscuit: 'MgqVq3OCTPeVHCEDr4HU',
  mochi: 'I8ERYU9lOxALy2vtIvHd',
  nora: 'pb6kCegKK9i4oRBqeUjR',        // from good-company/gc-friend.js
  cressida: 'RTBzdwjfw0SPTkN2srfl'
};
/* A recording cannot say the listener's name. Biscuit's own pet name for
   people is "sweet pea", so that is what the slot becomes. Where the same line
   already says "sweet pea" the slot is dropped, so she never says it twice. */
function fixNameSlot(text) {
  return String(text || '').split('\n').map((line) => {
    if (!line.includes('{name}')) return line;
    if (/sweet pea/i.test(line)) {
      return line.replace(/,?\s*\{name\}/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1');
    }
    return line
      .replace(/^(\w+) \{name\}/, '$1, sweet pea')
      .replace(/,\s*\{name\}/g, ', sweet pea')
      .replace(/\s*\{name\}/g, ', sweet pea');
  }).join('\n');
}

function speakable(text) {
  return fixNameSlot(text).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function plan(ep) {
  const parts = [];
  (ep.beats || []).forEach((b, i) => {
    const who = String(b.who || '').toLowerCase();
    if (!VOICES[who]) throw new Error(ep.id + ' beat ' + i + ': unknown speaker ' + who);
    parts.push({ who, text: speakable(b.text) });
  });
  if (ep.evening) parts.push({ who: 'biscuit', text: speakable(ep.evening), evening: true });
  return parts;
}

/* The saga voices already in Good Company (gc-friend.js). The other tellers (the narrator, the researchers, the colleagues, the mother) have none yet. */
const SAGA_VOICES = { alice: 'gZL79pBTvaNfNPOCXh6n', tansy: 'thfYL0Elyru2qqTtNQsE', poppy: 'VJFN2gyaDzoKekQ8ZuKB', blue: 'WUyjxM8OTY6l8LhTmdkq' };
const KIT_VOICE = 'azure:en-GB-Ada:DragonHDLatestNeural';        // Dr. O's pick for Kit, 2026-10-23

/* Fragments (A.L.I.C.E.'s laboratory saga, the fairies' Human Summer): each one is read in the voice of whoever tells it. A teller with no voice is SKIPPED and reported, never guessed. */
function planFragments(data, extraVoices) {
  const voices = Object.assign({}, SAGA_VOICES, extraVoices || {});
  const list = (data.fragments || data).slice();
  if (list.every((f) => typeof f.phase === 'number')) list.sort((a, b) => a.phase - b.phase);       // stable: file order inside a phase
  const parts = [], skipped = [];
  list.forEach((f) => {
    const who = String(f.perspective || '').toLowerCase();
    const text = speakable(f.text);
    if (!text) return;
    if (!voices[who]) { skipped.push({ id: f.id, who }); return; }
    parts.push({ who, voice: voices[who], text, id: f.id });
  });
  return { parts, skipped };
}

/* Kit's field notes (explorer-episodes.json): one spoken story each. The visitor is her boss, an in-joke of Dr. O's, so the {name} slot becomes "boss".
   Tilly's own words inside a story are read in Tilly's voice (Dr. O's pick, 2026-11-01). An episode lists them as tilly_lines, each one exactly as it is quoted in the text;
   everything else stays Kit's. Kit is Azure at 24 kHz, so Tilly (ElevenLabs) is asked for 24 kHz too: the pieces are joined end to end, and mp3 of two different
   sample rates joined like that can play at the wrong pitch. A line that is listed but cannot be found in the text is reported as skipped, never guessed. */
const TILLY_VOICE = 'ZF6FPAbjXT4488VcRRnw';
const TILLY_FORMAT = 'mp3_24000_48';
function kitParts(ep) {
  let rest = String(ep.text || '').replace(/\{name\}/g, 'boss').replace(/\s{2,}/g, ' ').trim();
  if (!rest) return { parts: [], skipped: [] };
  const parts = [], skipped = [];
  const kit = (t) => { t = String(t).trim(); if (/[A-Za-z0-9]/.test(t)) parts.push({ who: 'kit', voice: KIT_VOICE, text: t }); };
  let left = (ep.tilly_lines || []).map((l) => String(l).trim()).filter(Boolean);
  while (left.length) {
    let at = -1, pick = null;
    left.forEach((l) => { const i = rest.indexOf('"' + l + '"'); if (i >= 0 && (at < 0 || i < at)) { at = i; pick = l; } });
    if (pick === null) { left.forEach((l) => skipped.push({ id: ep.id, who: 'tilly line not found: ' + l.slice(0, 30) })); break; }
    kit(rest.slice(0, at));
    parts.push({ who: 'tilly', voice: TILLY_VOICE, format: TILLY_FORMAT, text: pick });
    rest = rest.slice(at + pick.length + 2);
    left = left.filter((l) => l !== pick);
  }
  kit(rest);
  return { parts, skipped };
}

module.exports = { VOICES, SAGA_VOICES, KIT_VOICE, TILLY_VOICE, TILLY_FORMAT, fixNameSlot, speakable, plan, planFragments, kitParts };
