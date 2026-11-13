// Offline support: cache the app shell. Truck data is never fetched from
// the network; it lives in IndexedDB on the device.
const VERSION = 'fj62-v1.0.0';
const ASSETS = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/logic.js', 'js/db.js', 'js/truck3d.js',
  'vendor/three.module.min.js', 'vendor/addons/controls/OrbitControls.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('fj62-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
