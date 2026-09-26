// Service worker: lets the app open without internet (Light, Qibla, Color, time and date work offline)
// and receives pictures shared from other apps ("Share → Eyes for Everyone").
const CACHE = 'eyes-v2';
const SHELL = [
  '/',
  '/css/app.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/settings.js',
  '/js/sounds.js',
  '/js/voice.js',
  '/js/camera.js',
  '/js/listen.js',
  '/js/commands.js',
  '/js/glass.js',
  '/js/sensors.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'eyes-share').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // A picture shared from another app: keep it for a moment, then open the app.
  // The app reads it and deletes it straight away.
  if (e.request.method === 'POST' && url.pathname === '/share') {
    e.respondWith(
      (async () => {
        try {
          const form = await e.request.formData();
          const file = form.getAll('image').find((f) => f && f.type?.startsWith('image/'));
          if (file) {
            const c = await caches.open('eyes-share');
            await c.put('/shared-image', new Response(file, { headers: { 'content-type': file.type } }));
          }
        } catch {}
        return Response.redirect('/?shared=1', 303);
      })()
    );
    return;
  }

  // Never cache the AI (photos, audio, answers stay private).
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // Network first, so updates arrive at once; the saved copy is used only when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (await caches.match('/')))
  );
});
