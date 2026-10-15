/* ── _azure — the three Azure services ETL uses besides Speech, added 2026-10-14, Dr. O ──────────────────────────
   Blob Storage (audio cache), AI Translator (text), and an Azure OpenAI / AI Foundry model deployment (chat).

   Every call here is OFF until its settings exist and NEVER throws into the caller's path: each returns null when it is
   not configured or when Azure answers badly, so a missing or wrong setting costs nothing and breaks nothing. Callers
   keep doing what they did before. Keys come from Netlify environment variables, never from the repo.

   Settings (Netlify, Site configuration, Environment variables):
     AZURE_BLOB_SAS_URL        a CONTAINER SAS URL with read, write and create, e.g.
                               https://<account>.blob.core.windows.net/<container>?sv=...&sig=...
     AZURE_TRANSLATOR_KEY      key of the Translator resource
     AZURE_TRANSLATOR_REGION   its region, e.g. eastus (needed for a regional resource)
     AZURE_TRANSLATOR_ENDPOINT optional, default https://api.cognitive.microsofttranslator.com
     AZURE_OPENAI_ENDPOINT     e.g. https://<resource>.openai.azure.com
     AZURE_OPENAI_KEY          key of that resource
     AZURE_OPENAI_DEPLOYMENT   the DEPLOYMENT name you gave the model in the portal
     AZURE_OPENAI_API_VERSION  optional, default 2024-10-21
   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

const TIMEOUT_MS = 20000;

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/* ── Blob Storage, through a container SAS URL (no SDK, no account key in the function) ── */
function blobTarget(key) {
  const raw = process.env.AZURE_BLOB_SAS_URL;
  if (!raw) return null;
  const q = raw.indexOf('?');
  if (q < 0) return null;
  const base = raw.slice(0, q).replace(/\/+$/, '');
  const path = String(key).split('/').map(encodeURIComponent).join('/');
  return base + '/' + path + '?' + raw.slice(q + 1);
}

async function blobGet(key) {
  const url = blobTarget(key);
  if (!url) return null;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: t.signal });
    if (r.status === 404) return null;
    if (!r.ok) { console.error('[azure] blob get', r.status); return null; }
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.error('[azure] blob get failed:', e && e.message);
    return null;
  } finally { t.done(); }
}

async function blobPut(key, buf, contentType) {
  const url = blobTarget(key);
  if (!url) return false;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'x-ms-version': '2021-08-06',
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buf.length),
      },
      body: buf,
      signal: t.signal,
    });
    if (!r.ok) { console.error('[azure] blob put', r.status); return false; }
    return true;
  } catch (e) {
    console.error('[azure] blob put failed:', e && e.message);
    return false;
  } finally { t.done(); }
}

/* ── Translator. texts: a string or an array of strings. Returns an array of translations, or null. ── */
async function translate(texts, to, from) {
  const key = process.env.AZURE_TRANSLATOR_KEY;
  if (!key || !to) return null;
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => ({ Text: String(t) }));
  const endpoint = (process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/, '');
  const params = new URLSearchParams({ 'api-version': '3.0', to: to });
  if (from) params.set('from', from);
  const headers = { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/json' };
  if (process.env.AZURE_TRANSLATOR_REGION) headers['Ocp-Apim-Subscription-Region'] = process.env.AZURE_TRANSLATOR_REGION;
  const t = withTimeout(TIMEOUT_MS);
  try {
    const r = await fetch(endpoint + '/translate?' + params.toString(), {
      method: 'POST', headers, body: JSON.stringify(list), signal: t.signal,
    });
    if (!r.ok) { console.error('[azure] translate', r.status, (await r.text()).slice(0, 160)); return null; }
    const j = await r.json();
    return j.map((x) => (x.translations && x.translations[0] && x.translations[0].text) || '');
  } catch (e) {
    console.error('[azure] translate failed:', e && e.message);
    return null;
  } finally { t.done(); }
}

/* ── Chat on an Azure OpenAI / AI Foundry deployment. messages: [{role, content}]. Returns the reply text, or null. ── */
async function chat(messages, opts) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const key = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !key || !deployment) return null;
  const version = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
  const o = opts || {};
  const t = withTimeout(o.timeoutMs || 45000);
  try {
    const r = await fetch(
      endpoint.replace(/\/+$/, '') + '/openai/deployments/' + encodeURIComponent(deployment) +
        '/chat/completions?api-version=' + encodeURIComponent(version),
      {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, max_tokens: o.maxTokens || 600, temperature: o.temperature == null ? 0.7 : o.temperature }),
        signal: t.signal,
      });
    if (!r.ok) { console.error('[azure] chat', r.status, (await r.text()).slice(0, 160)); return null; }
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return text ? String(text).trim() : null;
  } catch (e) {
    console.error('[azure] chat failed:', e && e.message);
    return null;
  } finally { t.done(); }
}

function configured() {
  return {
    blob: !!process.env.AZURE_BLOB_SAS_URL,
    translator: !!process.env.AZURE_TRANSLATOR_KEY,
    model: !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT),
  };
}

module.exports = { blobGet, blobPut, translate, chat, configured };
