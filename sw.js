// sw.js
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

// Permet à l'app de fonctionner même si le réseau est instable
self.addEventListener('fetch', (e) => {
  // On laisse passer les requêtes Supabase normalement
  if (e.request.url.includes('supabase.co')) return;
  
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});