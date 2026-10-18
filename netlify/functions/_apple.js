/* _apple: the developer token Apple Music's web player (MusicKit JS) needs, 2026-10-18, Dr. O: build the Apple Music player, she has an Apple developer account.

   Apple asks the website to prove it is allowed to use Apple Music by signing a short token with a private key from the developer account. Three values make that work:
   the Team ID, the Key ID, and the private key (the .p8 file). They are kept in the sun's private record, written from the panel and never sent back (same as the calendar link),
   because the site is at its limit of environment variables. Nothing here costs ETL anything: the listener signs in with their own Apple Music subscription.

   The token is ES256, built with Node's own crypto, no packages. It lasts 12 hours (Apple allows up to six months).
   NOT TRIED against Apple. The signing is checked here with a key made for the test; whether Apple accepts it depends on the real key and its Media ID. */
const crypto = require('crypto');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ID10 = /^[A-Z0-9]{10}$/;

/* Accepts the whole .p8 text, or just the long base64 part of it. Returns a PEM string, or '' when it is not a usable private key. */
function cleanPrivateKey(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  if (!/BEGIN PRIVATE KEY/.test(t)) {
    const body = t.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]{100,400}$/.test(body)) return '';
    t = '-----BEGIN PRIVATE KEY-----\n' + body.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----';
  } else {
    t = t.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }
  if (t.length > 1000) return '';
  try { crypto.createPrivateKey(t); } catch (_) { return ''; }
  return t;
}

function makeDeveloperToken({ teamId, keyId, privateKey }, { now = Date.now(), ttlSeconds = 12 * 3600 } = {}) {
  if (!ID10.test(String(teamId || '')) || !ID10.test(String(keyId || '')) || !privateKey) throw new Error('apple_not_set');
  const iat = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const body = b64u(JSON.stringify({ iss: teamId, iat, exp: iat + ttlSeconds }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { token: head + '.' + body + '.' + b64u(sig), expires_in: ttlSeconds };
}

module.exports = { cleanPrivateKey, makeDeveloperToken, ID10 };
