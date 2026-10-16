/* _gc-config: settings Good Company keeps in private storage (Netlify Blobs) instead of environment variables, 2026-10-16, Dr. O: the site is at its
   limit of environment variables, so adding more is not the answer.

   What it holds, in one private record:
     tester_hashes  a fingerprint (SHA-256) of each extra tester key, never the key itself, so even a status check cannot show one
     azure_key, azure_region  the Azure speech key and region for Astrad's American voice

   It is read with a short memory (60 seconds). Values are set only by gc-config.js, which needs the owner key. Anything not set here falls back to what was
   there before (the environment variable if one exists, then the built in list), so nothing stops working because this record is empty or cannot be read. */
const crypto = require('crypto');

let cache = { at: 0, data: null };
const TTL_MS = 60 * 1000;

function hash(key) {
  return crypto.createHash('sha256').update(String(key || '').trim()).digest('hex');
}

function store(event) {
  const { getStore, connectLambda } = require('@netlify/blobs');
  try { if (event) connectLambda(event); } catch (_) {}
  return getStore('gc_config');
}

async function load(event) {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  let data = {};
  try {
    const d = await store(event).get('config', { type: 'json' });
    if (d && typeof d === 'object') data = d;
  } catch (_) { /* unreadable: use the fallbacks */ }
  cache = { at: Date.now(), data };
  return data;
}

async function save(event, data) {
  await store(event).setJSON('config', data);
  cache = { at: Date.now(), data };
}

/* true when key is on the built in list or the environment list passed in, or its fingerprint is in the private record */
async function isTesterKey(event, key, builtIn) {
  const k = String(key || '').trim();
  if (!k) return false;
  if ((builtIn || []).indexOf(k) > -1) return true;
  const cfg = await load(event);
  return Array.isArray(cfg.tester_hashes) && cfg.tester_hashes.indexOf(hash(k)) > -1;
}

/* the Azure settings in the shape azureSpeak expects: private record first, then the environment */
async function azureEnv(event) {
  const cfg = await load(event);
  return {
    AZURE_SPEECH_KEY: cfg.azure_key || process.env.AZURE_SPEECH_KEY || '',
    AZURE_SPEECH_REGION: cfg.azure_region || process.env.AZURE_SPEECH_REGION || 'eastus',
  };
}

function resetCache() { cache = { at: 0, data: null }; }

module.exports = { hash, load, save, isTesterKey, azureEnv, resetCache };
