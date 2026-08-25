/* ============================================================================
   Dystoria — service worker (PWA sketch)

   What this does, and deliberately does not do:

   • The app is one big index.html that Cloudflare serves with
     `Cache-Control: no-cache, must-revalidate`, and the client polls /version
     every 15 minutes to offer "Back up & update". That design must survive:
     a deploy still shows up on the next load. So navigations are NETWORK-FIRST
     — the cache is only a fallback for when the network is gone or crawling.
     A late network response (after the timeout) is still written to the cache,
     so the *next* launch has the new build even on a bad connection.

   • Nothing that carries user data or money is ever cached: Supabase, the AI
     worker (/ai), billing, Stripe, PostHog, /version. Those requests are not
     even handled here — the browser does what it always did.

   • Third-party things the app cannot boot without (supabase-js from jsDelivr,
     the Google fonts) are cached so an offline launch still gets a working,
     properly-typeset app. The bundled datasets under /data/ are already
     immutable by policy (see _headers) and are cached on first use, forever.

   • Sounds are left alone: <audio> uses Range requests, and caching partial
     responses is where service workers get ugly. Ambience needs the network.

   Bump SW_VERSION to retire old caches. It is NOT tied to APP_VERSION — the app
   updates through network-first navigations, not through this file.
   ============================================================================ */
'use strict';

const SW_VERSION = 'dyst-sw-1';
const SHELL_CACHE = SW_VERSION + ':shell';       // the app documents
const RUNTIME_CACHE = SW_VERSION + ':runtime';   // fonts, supabase-js, datasets, icons
const NAV_TIMEOUT_MS = 8000;                     // "lie-fi" guard before we fall back to the cached app

// Everything the app needs to *boot* offline. Same-origin documents are keyed by
// pathname (query/hash stripped) — the app routes on ?home / #/read/… client-side.
const SHELL_URLS = ['/', '/welcome_undaunted.html', '/manifest.webmanifest'];
const THIRD_PARTY_BOOT = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];

// Paths that must never be served from any cache. Not handled at all.
const NEVER_CACHE = /^\/(ai|version|billing(\/|$)|hooks(\/|$)|stripe-webhook)/;

const SELF = self.location.origin;

/* ------------------------------ install / activate ------------------------------ */

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const shell = await caches.open(SHELL_CACHE);
    // addAll would reject the whole install on one failed fetch; we'd rather get
    // what we can — a missing welcome page is not a reason to have no offline app.
    await Promise.all(SHELL_URLS.map(function (u) { return putFresh(shell, u).catch(noop); }));
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(THIRD_PARTY_BOOT.map(function (u) {
      // no-cors: the <script> tag that loads it has no crossorigin attribute, so
      // the response we store must match that request mode (it will be opaque).
      return fetch(new Request(u, { mode: 'no-cors' }))
        .then(function (r) { return runtime.put(u, r); }).catch(noop);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.filter(function (n) { return n.indexOf(SW_VERSION + ':') !== 0; })
                           .map(function (n) { return caches.delete(n); }));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ------------------------------------ fetch ------------------------------------ */

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1. Documents — network-first, cached app as the fallback.
  if (req.mode === 'navigate') {
    if (url.origin === SELF && NEVER_CACHE.test(url.pathname)) return;
    event.respondWith(navigationResponse(event, url));
    return;
  }

  if (url.origin === SELF) {
    if (NEVER_CACHE.test(url.pathname)) return;                     // APIs: hands off
    if (url.pathname.indexOf('/sounds/') === 0) return;             // range requests: hands off
    if (url.pathname.indexOf('/data/') === 0 ||
        url.pathname.indexOf('/icons/') === 0 ||
        url.pathname === '/manifest.webmanifest') {
      event.respondWith(cacheFirst(req, RUNTIME_CACHE));            // immutable by policy
      return;
    }
    return;                                                          // anything else: default
  }

  // 2. Third-party assets the app needs to look and work right offline.
  const host = url.hostname;
  if (host === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));    // the CSS varies by browser; keep it fresh-ish
    return;
  }
  if (host === 'fonts.gstatic.com' || host === 'cdn.jsdelivr.net' || host === 'api.iconify.design') {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));              // versioned / immutable in practice
    return;
  }
  // Supabase, Stripe, PostHog, Polyhaven, Wikimedia, …: not ours to cache.
});

/* ---------------------------------- strategies --------------------------------- */

async function navigationResponse(event, url) {
  const key = url.origin === SELF ? url.pathname : url.href;         // '/?home' and '/#/read/x' → '/'
  const shell = await caches.open(SHELL_CACHE);

  // Start the real request immediately (navigation preload, when available, has
  // already started it in parallel with SW boot).
  const networkP = (async function () {
    const preloaded = await event.preloadResponse;
    return preloaded || fetch(event.request);
  })();

  // Whatever arrives from the network gets stored — even if it arrives too late
  // for this navigation. That is what makes a slow connection converge on the new
  // build instead of nagging "new version available" forever.
  const stored = networkP.then(function (res) {
    // (never store a redirected response — Chrome refuses to serve one to a later navigation)
    if (res && res.ok && !res.redirected && url.origin === SELF) {
      return shell.put(key, res.clone()).then(function () { return res; });
    }
    return res;
  });
  event.waitUntil(stored.catch(noop));

  try {
    const res = await withTimeout(stored, NAV_TIMEOUT_MS);
    if (res && (res.ok || res.status === 304 || res.type === 'opaqueredirect')) return res;
    // A real 4xx/5xx from the server: prefer the cached app to an error page only
    // when we actually have one; otherwise show the server's answer honestly.
    const cached = await shell.match(key);
    return cached || res;
  } catch (e) {
    // offline, DNS failure, or the timeout fired
    const cached = await shell.match(key) || (url.origin === SELF ? await shell.match('/') : null);
    if (cached) return cached;
    return offlinePage();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(noop);
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  const refresh = fetch(req).then(function (res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(noop);
    return res;
  }).catch(function () { return null; });
  if (hit) return hit;
  const res = await refresh;
  if (res) return res;
  throw new Error('offline and not cached: ' + req.url);
}

/* ----------------------------------- helpers ----------------------------------- */

async function putFresh(cache, path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(path + ' → ' + res.status);
  await cache.put(path, res);
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

function offlinePage() {
  // Only reached on a first-ever visit with no network — nothing to show but this.
  const html = '<!doctype html><meta charset="utf-8"><title>Dystoria — offline</title>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#2B2926;color:#e8dcc4;' +
    'font:18px/1.5 Georgia,serif;text-align:center;padding:2rem">' +
    '<div><p style="font-size:2rem;margin:0 0 .5rem">Dystoria</p><p>You’re offline, and Dystoria hasn’t been opened on this device yet.<br>' +
    'Connect once and it will be here for you afterwards, online or not.</p></div></body>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function noop() {}

/* Let the page ask us things (used by the in-app "Install" row and diagnostics). */
self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data.type === 'dyst-sw-ping' && event.source) {
    event.source.postMessage({ type: 'dyst-sw-pong', version: SW_VERSION });
  }
});
