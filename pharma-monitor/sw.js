// Pass-through service worker. It exists only so that Edge and Chrome offer "Install app" (Windows, Mac, Android).
// Nothing is cached: every request goes to the network, so the installed app always shows live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
