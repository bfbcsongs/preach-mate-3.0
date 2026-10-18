const CACHE_NAME = 'preach-mate-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-auth.js',
  './cloud-sync.js',
  './logo.png',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install Event: Caches critical files without skipping waiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event: Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch Event: Bypass SW cache strictly for version.json and main page navigation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Direct network bypass para sa version.json
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first strategy para sa lahat ng assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
