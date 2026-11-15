const CACHE_NAME = 'kotxea-shell-v24';
const SHELL_FILES = [
    './',
    './index.html',
    './styles.css',
    './styles.css?v=21',
    './script.js',
    './script.js?v=16',
    './cloud.js',
    './cloud.js?v=20',
    './firebase-config.js',
    './manifest.json',
    './assets/kotxea-icon.svg'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kotxea-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET') return;

    if (url.origin !== self.location.origin) {
        if (request.destination === 'script' && url.hostname === 'www.gstatic.com') {
            event.respondWith(caches.open(CACHE_NAME).then(async cache => {
                try {
                    const response = await fetch(request);
                    if (response.ok) cache.put(request, response.clone());
                    return response;
                } catch (_) {
                    return (await cache.match(request)) || Response.error();
                }
            }));
        }
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(fetch(request).then(response => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
            return response;
        }).catch(() => caches.match('./index.html')));
        return;
    }

    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
