// Caches ONLY the app shell (HTML, CSS, JS, icons) so the app opens fast like an installed app.
// Customer data never goes into this cache: API calls go to script.google.com (another origin) and are
// never touched here, and only the files listed below are ever stored.
const CACHE = 'bimeyar-v4.4.1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/util.js', 'js/i18n.js', 'js/config.js', 'js/store-local.js', 'js/store-remote.js',
  'js/auth.js', 'js/assistant.js', 'js/demo.js', 'js/invoice.js', 'js/validate.js', 'js/ai.js', 'js/naming.js', 'js/device.js', 'js/vehicles.js', 'js/dates.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const SHELL_PATHS = new Set(SHELL.map(p => new URL(p, self.registration.scope).pathname));

// cache: 'reload' = download fresh from the server, never from the browser's HTTP cache
// (otherwise a new version can be installed with the old files).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Own shell files only; everything else (Google sign-in, the backend, fonts) passes through untouched.
// Network first, cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !SHELL_PATHS.has(url.pathname)) return;
  e.respondWith(
    // no-cache = always ask the server if the file changed, so a new version is never hidden by the browser cache
    // Fetch by URL: a page-navigation request cannot be copied with new options (that throws and would serve the old cache).
    fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); }
      return r;
    }).catch(() => caches.match(url.pathname).then(r => r || caches.match(new URL('index.html', self.registration.scope).pathname)))
  );
});
