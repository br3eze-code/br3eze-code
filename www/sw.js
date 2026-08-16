/* AgentOS offline-first service worker. Server mutations are never fabricated locally. */
'use strict';

const CACHE_NAME = 'agentos-shell-v8';
const APP_SHELL = [
    './', 'index.html', 'manifest.json', 'sw.js',
    'css/index.css', 'js/env.js', 'js/offline-runtime.js', 'js/03.notifications.js',
    'js/vendor-qrcode.js', 'js/shop.js', 'js/chat.js', 'js/index.js',
    'js/15.hardware.print.js', 'js/app.js', 'js/forgot-password.js', 'js/payments.js',
    'img/logo.png', 'img/icon-192.png', 'img/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => undefined)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))));
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())).catch(() => {});
        return response;
    }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('index.html');
        return Response.error();
    }));
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'agentos-outbox-sync') event.waitUntil(notifyClientsToSync());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'agentos-sync') event.waitUntil?.(notifyClientsToSync());
});

async function notifyClientsToSync() {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map((client) => client.postMessage({ type: 'agentos-sync-request' })));
}
