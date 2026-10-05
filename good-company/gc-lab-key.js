/* gc-lab-key: plants the lab key and sends it to this site's server functions.
   Visit any page that loads this with ?labkey=<key>; it is stored in
   localStorage (etl_lab_key) and stripped from the address bar. After that,
   every same-origin call to a Netlify function carries it as the x-lab-key
   header. The server (LAB_KEYS env var) is the only authority: this file never
   decides anything is paid. A rejected key just means the normal paywall. */
(function () {
  var KEY = 'etl_lab_key';
  try {
    var q = new URLSearchParams(location.search);
    var k = q.get('labkey');
    if (k) {
      localStorage.setItem(KEY, k.trim());
      q.delete('labkey');
      var qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  } catch (e) {}
  var key = '';
  try { key = localStorage.getItem(KEY) || ''; } catch (e) {}
  if (!key || !window.fetch || window.__etlLabKeyWrapped) return;
  window.__etlLabKeyWrapped = true;
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.indexOf('/.netlify/functions/') === 0) {
        init = init || {};
        var h = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || {});
        if (!h.has('x-lab-key')) h.set('x-lab-key', key);
        init.headers = h;
      }
    } catch (e) {}
    return orig(input, init);
  };
})();
