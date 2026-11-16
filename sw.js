// Caches the app shell so it opens fast like an installed app (and offline in "this device" mode)
const CACHE = 'bimeyar-v2';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/util.js', 'js/i18n.js', 'js/config.js', 'js/store-local.js', 'js/store-remote.js', 'js/auth.js', 'js/assistant.js', 'js/demo.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Own files only; Google requests pass through untouched. Network first, cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
