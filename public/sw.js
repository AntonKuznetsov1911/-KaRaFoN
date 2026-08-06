/**
 * KaRaFoN Service Worker
 * Cache-first для локальных ресурсов, network-only для CDN.
 *
 * Это позволяет:
 * - Быструю загрузку приложения (кэш)
 * - Автономную работу без интернета
 * - Установку на рабочий стол как PWA
 */

const CACHE_NAME = 'karafon-v2';

// Локальные файлы — кэшируем всегда
const LOCAL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/audio.js',
  './js/webrtc.js',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(LOCAL_ASSETS))
      .then(() => {
        console.log('[SW] All assets cached');
        return self.skipWaiting(); // Активируемся немедленно
      })
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim()) // Берём контроль над всеми вкладками
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CDN-ресурсы (PeerJS, Telegram) — всегда из сети, не кэшируем
  const isCDN = !url.origin.includes(self.location.origin);
  if (isCDN) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Локальные ресурсы — сначала кэш, при промахе идём в сеть и обновляем кэш
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Параллельно обновляем кэш в фоне (stale-while-revalidate)
        fetch(event.request)
          .then(fresh => {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, fresh));
          })
          .catch(() => {}); // Нет сети — ничего страшного, у нас кэш
        return cached;
      }

      // Промах кэша — идём в сеть
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ─── Push (для будущих уведомлений) ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'KaRaFoN', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png'
  });
});
