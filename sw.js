// Офлайн-кэш приложения. При обновлении файлов поменяйте номер версии.
const CACHE = 'flipologia-v49';
const FILES = ['./', 'index.html', 'rayony-data.js', 'shablony-data.js', 'fonts/golos-400.ttf', 'fonts/golos-600.ttf', 'fonts/golos-800.ttf', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сначала сеть (чтобы видеть обновления), без сети — из кэша
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      // В кэш только удачные ответы своего сайта: ошибка сервера не должна затереть рабочую копию
      if (r.ok && r.type === 'basic') {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
