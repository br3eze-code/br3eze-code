/**
 * Power Connect / AgentOS — service worker
 * Stale-while-revalidate cache for the local app shell only.
 * Cross-origin requests (Firebase, Font Awesome/Google Fonts CDNs) are
 * left untouched and always go to the network.
 */
'use strict';

const CACHE_NAME = 'power-connect-shell-v1';
const APP_SHELL = [
    'index.html',
    'manifest.json',
    'css/index.css',
    'js/index.js',
    'js/app.js',
    'img/logo.png'
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
    if (url.origin !== self.location.origin) return; // let cross-origin requests pass through untouched

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
