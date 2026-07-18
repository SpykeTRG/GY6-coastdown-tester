// ПРИ ОБНОВЛЕНИИ ПРОСТО МЕНЯЙТЕ v1 НА v2, v3 И Т.Д.
const CACHE_NAME = 'gy6-telemetry-v5'; 

const ASSETS = [
  'index.html',
  'style.css',
  'script.js',
  'manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// АВТОМАТИЧЕСКОЕ УДАЛЕНИЕ СТАРЫХ ВЕРСИЙ КЭША
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          // Если имя старого кэша в памяти телефона не совпадает с текущим CACHE_NAME — удаляем его
          if (cache !== CACHE_NAME) {
            console.log('Удаление старого кэша:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});
