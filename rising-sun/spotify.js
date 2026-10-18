/* spotify.js: the sign-in steps for Spotify, shared by the panel (in the browser) and the test (in node), 2026-10-18.

   Spotify's "Authorization Code with PKCE" sign-in needs NO secret: only the app's client id (public) and a one-time random verifier made in the browser. So nothing private is stored on the website for Spotify.
   The listener signs in with their own Spotify Premium account. NOT TRIED against Spotify; the challenge is checked against the example in RFC 7636. */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(); else root.SunSpotify = make();
})(typeof self !== 'undefined' ? self : this, function () {
  var SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private';

  function b64u(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(n) {
    var a = new Uint8Array(n); (globalThis.crypto || self.crypto).getRandomValues(a);
    return b64u(a).slice(0, n);
  }
  function verifier() { return randomString(64); }
  function challenge(v) {
    var data = new TextEncoder().encode(v);
    return (globalThis.crypto || self.crypto).subtle.digest('SHA-256', data).then(function (d) { return b64u(new Uint8Array(d)); });
  }
  function authUrl(o) {
    var q = new URLSearchParams({ client_id: o.clientId, response_type: 'code', redirect_uri: o.redirectUri, scope: SCOPES, code_challenge_method: 'S256', code_challenge: o.challenge, state: o.state });
    return 'https://accounts.spotify.com/authorize?' + q.toString();
  }
  function codeBody(o) { return new URLSearchParams({ grant_type: 'authorization_code', code: o.code, redirect_uri: o.redirectUri, client_id: o.clientId, code_verifier: o.verifier }).toString(); }
  function refreshBody(o) { return new URLSearchParams({ grant_type: 'refresh_token', refresh_token: o.refresh, client_id: o.clientId }).toString(); }
  /* A token answer becomes what is kept: when it stops working (a minute early, to be safe) and the refresh token, which Spotify may leave out on a refresh. */
  function keep(answer, old, now) {
    now = now || Date.now();
    return { access: answer.access_token, refresh: answer.refresh_token || (old && old.refresh) || '', exp: now + Math.max(0, (answer.expires_in || 3600) - 60) * 1000 };
  }
  function fresh(t, now) { return !!(t && t.access && t.exp > (now || Date.now())); }
  /* Spotify's search and playlist answers, turned into the same shape the panel's rows already use. */
  function row(kind, x) {
    if (!x) return null;
    var img = (x.album && x.album.images || x.images || [])[0];
    var who = kind === 'songs' ? (x.artists || []).map(function (a) { return a.name; }).join(', ') : kind === 'albums' ? (x.artists || []).map(function (a) { return a.name; }).join(', ') : ((x.owner || {}).display_name || '');
    return { id: x.id, uri: x.uri, svc: 'spotify', attributes: { name: x.name, artistName: who, artwork: img ? { url: img.url } : null } };
  }
  return { SCOPES: SCOPES, verifier: verifier, challenge: challenge, authUrl: authUrl, codeBody: codeBody, refreshBody: refreshBody, keep: keep, fresh: fresh, row: row, randomString: randomString };
});
