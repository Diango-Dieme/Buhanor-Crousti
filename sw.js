// sw.js — Buhanor Crousti PWA
// Stratégie :
//  • Precache du shell (app utilisable immédiatement, même offline)
//  • Network-first pour le HTML (toujours frais quand en ligne)
//  • Cache-first pour les assets statiques (rapide, économique)
//  • Supabase & API toujours en direct (jamais de cache)

const CACHE_VERSION = 'buhanor-v2'; // ⚠️ Incrémente à chaque déploiement majeur
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/Logo%20buhanor%20crousti.jpg'
];

// ---------- INSTALL : pré-cache du shell ----------
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Prend le contrôle immédiatement
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn('[SW] Precache partiel :', err))
  );
});

// ---------- ACTIVATE : purge des anciens caches ----------
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------- FETCH : stratégies par type ----------
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Ignore les requêtes non-GET (POST vers Supabase, etc.)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Supabase & API : JAMAIS de cache (realtime, RPC, données fraîches)
  if (url.hostname.includes('supabase.co') || url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Navigation / HTML : Network-first (contenu toujours à jour en ligne)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 3. Assets statiques (images, fonts, CSS, JS) : Cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // On ne cache que les réponses valides de notre origine ou des CDN connus
          if (res && res.ok && (url.origin === location.origin || url.hostname.includes('images.unsplash.com') || url.hostname.includes('fonts.g'))) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Fallback image cassée → placeholder burger
          if (req.destination === 'image') {
            return caches.match('/Logo%20buhanor%20crousti.jpg');
          }
        });
    })
  );
});