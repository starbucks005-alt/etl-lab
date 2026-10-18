/* gc-config: the owner's way to set Good Company's private settings without an environment variable, 2026-10-16.
   POST with  Authorization: Bearer <owner key>  and a JSON body:
     { "action": "status" }                       what is set (never shows a key)
     { "action": "add_tester", "key": "..." }     allow one more tester key
     { "action": "clear_testers" }                forget every key added this way
     { "action": "set_azure", "key": "...", "region": "eastus" }
     { "action": "clear_azure" }
     { "action": "set_sun_key", "key": "..." }    the Rising Sun's access code, kept as a fingerprint
     { "action": "add_sun_tester", "name": "...", "key": "..." }   a tester's own Rising Sun code (own settings and chats, never the provider keys)
     { "action": "remove_sun_tester", "name": "..." }
   Nothing here ever sends a secret back. Keys are stored as fingerprints (testers) or in private storage (Azure). */
const { ownerUser } = require('./_owner-auth.js');
const cfgmod = require('./_gc-config.js');

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (statusCode, o) => ({ statusCode, headers: H, body: JSON.stringify(o) });

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = String((event.headers && (event.headers.authorization || event.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
  /* the campus owner key, or Good Company's own owner key (the one the hologram ?key= link uses), same two doors gc-chat.js accepts */
  const gcOwnerKey = String(process.env.GC_OWNER_KEY || '').trim();
  if (!ownerUser(token) && !(gcOwnerKey && token === gcOwnerKey)) return json(401, { error: 'owner_key_needed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'bad_json' }); }

  cfgmod.resetCache();
  const cfg = Object.assign({}, await cfgmod.load(event));
  const action = String(body.action || 'status');

  if (action === 'add_tester') {
    const k = String(body.key || '').trim();
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(k)) return json(400, { error: 'key_must_be_12_to_80_letters_numbers_dash_or_underscore' });
    const list = Array.isArray(cfg.tester_hashes) ? cfg.tester_hashes : [];
    const h = cfgmod.hash(k);
    if (list.indexOf(h) === -1) list.push(h);
    cfg.tester_hashes = list.slice(-20);
  } else if (action === 'clear_testers') {
    cfg.tester_hashes = [];
  } else if (action === 'set_azure') {
    const k = String(body.key || '').trim();
    const region = String(body.region || 'eastus').trim().toLowerCase();
    if (!/^[A-Za-z0-9]{20,100}$/.test(k)) return json(400, { error: 'that does not look like an azure key' });
    if (!/^[a-z0-9-]{3,30}$/.test(region)) return json(400, { error: 'bad_region' });
    cfg.azure_key = k;
    cfg.azure_region = region;
  } else if (action === 'clear_azure') {
    delete cfg.azure_key;
    delete cfg.azure_region;
  } else if (action === 'set_sun_key') {
    const k = String(body.key || '').trim();
    if (!/^[\x21-\x7e]{12,80}$/.test(k)) return json(400, { error: 'The access code needs 12 to 80 characters with no spaces, using plain letters, numbers or symbols from the keyboard.' });
    cfg.sun_key_hash = cfgmod.hash(k);
  } else if (action === 'add_sun_tester') {
    const id = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const k = String(body.key || '').trim();
    if (!id) return json(400, { error: 'Give the tester a name.' });
    if (!/^[\x21-\x7e]{12,80}$/.test(k)) return json(400, { error: 'The access code needs 12 to 80 characters with no spaces, using plain letters, numbers or symbols from the keyboard.' });
    const list = (Array.isArray(cfg.sun_testers) ? cfg.sun_testers : []).filter((x) => x.id !== id);
    list.push({ id, hash: cfgmod.hash(k) });
    cfg.sun_testers = list.slice(-20);
  } else if (action === 'remove_sun_tester') {
    const id = String(body.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    cfg.sun_testers = (Array.isArray(cfg.sun_testers) ? cfg.sun_testers : []).filter((x) => x.id !== id);
  } else if (action !== 'status') {
    return json(400, { error: 'unknown_action' });
  }

  if (action !== 'status') {
    try { await cfgmod.save(event, cfg); } catch (e) { return json(500, { error: 'could_not_save' }); }
  }
  return json(200, {
    ok: true,
    tester_keys_added: (cfg.tester_hashes || []).length,
    azure_key_set: !!cfg.azure_key,
    azure_region: cfg.azure_region || null,
    sun_key_set: !!cfg.sun_key_hash,
    sun_testers: (cfg.sun_testers || []).map((x) => x.id),
  });
};
