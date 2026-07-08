/**
 * Power Connect — service worker (PWA install + offline shell)
 *
 * NETWORK-FIRST for everything same-origin: fresh deploys are always picked
 * up immediately (this app once shipped a broken bundle that browser caching
 * kept alive for an hour — the SW must never make that worse). The cache is
 * only a fallback for offline use.
 */
'use strict';

const CACHE_NAME = 'power-connect-shell-v6';
const APP_SHELL = [
    './',
    'index.html',
    'manifest.json',
    'css/index.css',
    'js/env.js',
    'js/03.notifications.js',
    'js/vendor-qrcode.js',
    'js/shop.js',
    'js/chat.js',
    'js/index.js',
    'js/15.hardware.print.js',
    'js/app.js',
    'img/logo.png',
    'img/icon-192.png',
    'img/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch((err) => console.warn('[sw] precache failed:', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return; // Firebase/CDNs go straight to network

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response && response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => { });
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(event.request);
                if (cached) return cached;
                // Offline navigation falls back to the cached shell
                if (event.request.mode === 'navigate') {
                    const shell = await caches.match('index.html');
                    if (shell) return shell;
                }
                return Response.error();
            })
    );
});
