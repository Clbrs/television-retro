// Guarda la app para que abra rápido. Los vídeos no se guardan aquí (llegan a trozos por el script).
const VERSION = 'tvretro-v2';
const APP = ['./', 'index.html', 'app.js?v=2', 'app.css?v=2', 'manifest.webmanifest', 'tele.png', 'icono-192.png', 'icono-512.png', 'icono-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'imagenes').map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // no-cache: pregunta siempre a GitHub si hay versión nueva; sin conexión, sirve la guardada
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
