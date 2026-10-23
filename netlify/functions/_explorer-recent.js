/* _explorer-recent: the stories Kit has just told, as a short note for her chat, 2026-10-23, Dr. O ("let Kit's chat learn the stories she has just told, the way Reggie does").
   Reads the same Blobs store explorer-story.js writes ('explorer', key 'episodes'). Only stories that were fact-checked (verified) are used.
   Returns '' when there is nothing, or no store. Never throws. */
async function recentNote(event, deps) {
  try {
    const d = deps || {};
    let st = d.store;
    if (!st) {
      const { getStore, connectLambda } = require('@netlify/blobs');
      try { connectLambda(event); } catch (_) {}
      st = getStore('explorer');
    }
    const kept = await st.get('episodes', { type: 'json' });
    if (!Array.isArray(kept)) return '';
    const good = kept.filter((e) => e && e.verified === true && e.place && e.text);
    if (!good.length) return '';
    const lines = good.slice(-3).map((e) => '- ' + e.place + ': ' + String(e.text)
      .replace(/Sorry, \{name\}, I have to go, they're on to me\./g, '')
      .replace(/\{name\}/g, 'a friend').replace(/\s+/g, ' ').trim().slice(0, 400));
    return '\nSTORIES YOU HAVE TOLD LATELY on the stories page ("What has Kit been up to?"). Mention one now and then, in a few sentences, as something you remember telling. Do not recite them, do not add trips or facts that are not here, and if someone asks for more, send them to the stories page.\n' + lines.join('\n') + '\n';
  } catch (_) { return ''; }
}
module.exports = { recentNote };
