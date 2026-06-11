/* ─────────────────────────────────────────────────────────────────────────────
   Studio PWA service worker

   What this does:
   - On install, caches the Studio shell (HTML + a couple of static assets) so
     the app opens when the buyer is offline. They see the room; the agents
     can't do anything until WiFi is back, but the icon-click-to-app feel
     never breaks.
   - On fetch, two strategies:
       * Network-first for API / Netlify Function calls (so live data stays live)
       * Cache-first for the shell + static images (instant icon-click)
   - On activate, sweeps old caches so stale Studio assets don't linger.

   Versioning: bump CACHE on every shell change. Old caches are deleted on
   activate so buyers don't get stuck on a stale Studio.
   ───────────────────────────────────────────────────────────────────────── */

const CACHE = 'etl-studio-v4'; // bump on asset swaps so cached images purge

const SHELL = [
  '/studio.html',
  '/inma.html',
  '/manifest.json',
  '/inma-manifest.json',
  '/favicon.png',
  '/favicon_etl_512.png',
  '/inma-crest-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Only handle same-origin. CDN fonts, Supabase, Anthropic, etc. go straight to network.
  if (url.origin !== self.location.origin) return;

  // Network-first for backend / API calls. Live data must stay live; only
  // fall back to cache if the network is fully gone.
  const isApi = url.pathname.startsWith('/.netlify/functions/')
             || url.pathname.startsWith('/api/')
             || url.pathname.startsWith('/studio-')
             || url.pathname.startsWith('/auggie-')
             || url.pathname.startsWith('/watercooler')
             || url.pathname.startsWith('/press')
             // Pages and data must never be served stale by the worker. Page
             // navigations, any .html, and any .json (roster.json especially)
             // go network-first so the live site always wins. This is what
             // stopped the catalog from updating: the old worker cached
             // hiring-pool.html + roster.json cache-first and froze them.
             || req.mode === 'navigate'
             || url.pathname.endsWith('.html')
             || url.pathname.endsWith('.json');
  if (isApi) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Don't cache API responses (always go fresh next time).
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for shell + static assets. If the request is in the cache,
  // serve it instantly; otherwise fetch and silently warm the cache for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Only cache successful, basic-type responses (skip opaque, errors, etc.).
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => null);
        return resp;
      }).catch(() => caches.match('/studio.html'));
    })
  );
});
