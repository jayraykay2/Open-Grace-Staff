/**
 * og-sw.js — Open Grace Director Portal Service Worker
 * Enables PWA install, offline shell, and fast subsequent loads.
 *
 * Strategy:
 *   - director.html: network-first (always fresh), cache fallback
 *   - Assets (logo, fonts): cache-first
 *   - API calls (Worker, GitHub): network-only, never cached
 */

const CACHE_NAME    = 'og-director-v1';
const SHELL_ASSETS  = [
  '/director.html',
  '/og_logo.jpg',
  '/og-passkey.js',
];

// ── Install: pre-cache shell ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing strategy ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept: API calls, GitHub, Cloudflare Worker
  const passThrough = [
    'og-security-worker.jayraykay2.workers.dev',
    'api.github.com',
    'workers.dev',
    'cloudflare',
    'one.dash.cloudflare.com',
  ];
  if (passThrough.some(h => url.hostname.includes(h))) return;

  // director.html — network first, cache fallback
  if (url.pathname === '/director.html' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match('/director.html'))
    );
    return;
  }

  // Everything else — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
