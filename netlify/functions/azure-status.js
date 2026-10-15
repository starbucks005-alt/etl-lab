/* azure-status — GET  ->  { ok, configured: { blob, translator, model }, checks }
   Says which Azure services are set up, and with ?check=1 makes one tiny real call to each, so you can see from a browser
   that the three are working and that the credits are being used. It never returns a key or any stored content. Added
   2026-10-14, Dr. O. */

const azure = require('./_azure.js');

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  const cfg = azure.configured();
  const out = { ok: true, configured: cfg };
  const check = event.queryStringParameters && event.queryStringParameters.check;
  if (check) {
    out.checks = {};
    if (cfg.blob) {
      const key = '_status/ping.txt';
      const put = await azure.blobPut(key, Buffer.from('ok ' + new Date().toISOString()), 'text/plain');
      const got = put ? await azure.blobGet(key) : null;
      out.checks.blob = put && got ? 'ok' : 'failed';
    }
    if (cfg.translator) {
      const t = await azure.translate('Good morning', 'es', 'en');
      out.checks.translator = t && t[0] ? 'ok' : 'failed';
    }
    if (cfg.model) {
      const m = await azure.chat([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 10, temperature: 0 });
      out.checks.model = m ? 'ok' : 'failed';
    }
  }
  return { statusCode: 200, headers, body: JSON.stringify(out) };
};
