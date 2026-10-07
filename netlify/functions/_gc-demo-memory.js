/* _gc-demo-memory: the memory key for a HOUSE character (Alice, Reggie, Sophia, Tansy, Arch ...), 2026-10-07.

   gc-chat.js has always remembered a visitor for a BUILT friend (one with an .id), in the shared
   etl_visitor_memories table, keyed by the person (account token, else the browser's visitor id). A house character
   has no .id, so the key was null and nothing was ever kept: "a demo character remembering individual visitors is a
   real, separate feature". Dr. O asked for it for the hologram and AR pages.

   It is OPT IN PER REQUEST: the page must send remember: true, so every other caller behaves exactly as before.
   The key is "gcd:" plus the character's name, so it can never collide with a built friend's "gc:" + id, and
   gc-forget.js can be limited to "gcd:" keys. */
function demoMemoryKey(friend, remember) {
  if (remember !== true || !friend || typeof friend !== 'object' || friend.id) return null;
  const slug = String(friend.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug ? 'gcd:' + slug : null;
}

module.exports = { demoMemoryKey };
