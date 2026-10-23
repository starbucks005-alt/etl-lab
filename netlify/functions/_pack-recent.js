/* _pack-recent: the outings the story generator has written since the three seed stories, as a short note for Reggie, 2026-10-23, Dr. O ("connect the stories to reggie").
   Reads the same Blobs store pack-story.js writes ('pack', key 'episodes'). Returns '' when there is nothing, or no store. Never throws. */
async function recentNote(event, deps) {
  try {
    const d = deps || {};
    let st = d.store;
    if (!st) {
      const { getStore, connectLambda } = require('@netlify/blobs');
      try { connectLambda(event); } catch (_) {}
      st = getStore('pack');
    }
    const kept = await st.get('episodes', { type: 'json' });
    if (!Array.isArray(kept) || !kept.length) return '';
    const lines = kept.slice(-4).map((e) => '- ' + e.place + ': ' + String(e.text || '').replace(/\{name\}/g, 'a friend').replace(/Gotta go,[^]*$/i, '').trim().slice(0, 420));
    return '\nMORE OUTINGS THE THREE OF THEM HAVE BEEN ON LATELY, as Biscuit told them. Same rules as his other outings: mention one now and then, in a few sentences, do not recite them.\n' + lines.join('\n') + '\n';
  } catch (_) { return ''; }
}
module.exports = { recentNote };
