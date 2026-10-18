/* sun-spotify.test.js: plain node, `node tests/sun-spotify.test.js`. Checks the sign-in steps and the settings that hold the client id. No network. */
const assert = require('assert');
const sp = require('../rising-sun/spotify.js');
const settings = require('../netlify/functions/sun-settings.js');
(async () => {
  // RFC 7636, appendix B: the published example
  assert.strictEqual(await sp.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const v = sp.verifier(); assert(/^[A-Za-z0-9_-]{64}$/.test(v)); assert.notStrictEqual(v, sp.verifier());
  const u = new URL(sp.authUrl({ clientId: 'abc', redirectUri: 'https://emerging-tech-lab.com/rising-sun/', challenge: 'CH', state: 'ST' }));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.strictEqual(u.searchParams.get('response_type'), 'code'); assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://emerging-tech-lab.com/rising-sun/'); assert.strictEqual(u.searchParams.get('state'), 'ST');
  assert(/streaming/.test(u.searchParams.get('scope')) && /user-modify-playback-state/.test(u.searchParams.get('scope')) && !u.searchParams.has('client_secret'));   // no secret anywhere
  const cb = new URLSearchParams(sp.codeBody({ code: 'C', redirectUri: 'R', clientId: 'I', verifier: 'V' }));
  assert.strictEqual(cb.get('grant_type'), 'authorization_code'); assert.strictEqual(cb.get('code_verifier'), 'V'); assert(!cb.has('client_secret'));
  assert.strictEqual(new URLSearchParams(sp.refreshBody({ refresh: 'RT', clientId: 'I' })).get('grant_type'), 'refresh_token');
  const t = sp.keep({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }, null, 1000);
  assert.deepStrictEqual(t, { access: 'A', refresh: 'R', exp: 1000 + 3540 * 1000 });
  assert.strictEqual(sp.keep({ access_token: 'A2', expires_in: 3600 }, t, 5000).refresh, 'R');                       // a refresh that leaves out the refresh token keeps the old one
  assert(sp.fresh(t, 2000) && !sp.fresh(t, 1000 + 3540 * 1000 + 1) && !sp.fresh(null));
  const song = sp.row('songs', { id: '1', uri: 'spotify:track:1', name: 'Here Comes the Sun', artists: [{ name: 'The Beatles' }], album: { images: [{ url: 'img' }] } });
  assert.deepStrictEqual(song, { id: '1', uri: 'spotify:track:1', svc: 'spotify', attributes: { name: 'Here Comes the Sun', artistName: 'The Beatles', artwork: { url: 'img' } } });
  assert.strictEqual(sp.row('playlists', { id: 'p', uri: 'spotify:playlist:p', name: 'Mix', owner: { display_name: 'Me' }, images: [] }).attributes.artistName, 'Me');
  assert.strictEqual(sp.row('playlists', null), null);                                                                // Spotify sometimes sends a null in a list
  // the client id is saved (it is public), checked, and clearable
  const mem = {}; const store = { get: async (k) => mem[k] || null, setJSON: async (k, x) => { mem[k] = JSON.parse(JSON.stringify(x)); } };
  const call = (body) => settings.handler({ httpMethod: 'POST', headers: { 'x-sun-key': 'k' }, body: JSON.stringify(body) }, {}, { env: { SUN_DEVICE_KEY: 'k' }, store });
  let r = JSON.parse((await call({ spotify_client_id: '0123456789abcdef0123456789ABCDEF' })).body).settings;
  assert.strictEqual(r.spotify_client_id, '0123456789abcdef0123456789abcdef');
  r = JSON.parse((await call({ spotify_client_id: 'not an id' })).body).settings;
  assert.strictEqual(r.spotify_client_id, '0123456789abcdef0123456789abcdef');                                       // a bad one is refused
  r = JSON.parse((await call({ spotify_client_id: '' })).body).settings;
  assert.strictEqual(r.spotify_client_id, '');
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
