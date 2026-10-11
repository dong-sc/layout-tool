/* 自動排版工具 service worker：網路優先，離線退回快取（確保更新即時生效） */
const CACHE = 'layout-tool-v5';
const ASSETS = ['./', './index.html', './m/index.html', './editor-plus.js?v=1', './editor-plus.css?v=1', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('layout-tool-') && k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if(r.ok){
        const copy = r.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
      }
      return r;
    }).catch(async () => (await caches.match(e.request)) || Response.error())
  );
});

