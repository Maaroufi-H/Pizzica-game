/* Pizzica Master V7 - service worker (PWA / TWA Play Store)
   Strategie: network-first pour les fichiers du jeu (toujours a jour),
   fallback cache si hors ligne. Les gros medias passent en cache-first. */

const CACHE_NAME = 'pizzica-v7-2';

const CORE_ASSETS = [
    './',
    'index.html',
    'style.css',
    'game.js',
    'manifest.webmanifest',
    'man.png',
    'woman.png',
    'cercle.jpg',
    'pizz2.jpg',
    'icon-192.png',
    'icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

    const isMedia = /\.(mp3|mp4)(\?.*)?$/i.test(req.url);

    if (isMedia) {
        // Cache-first pour les gros medias. Les elements <audio>/<video>
        // envoient quasi toujours un header Range: on cle le cache par URL
        // et on recupere/stocke le fichier COMPLET (une reponse 200 complete
        // est acceptee par les elements media meme pour une requete Range).
        event.respondWith(
            caches.match(req.url).then((cached) => {
                if (cached) return cached;
                return fetch(req.url).then((resp) => {
                    if (resp.ok && resp.status === 200) {
                        const copy = resp.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(req.url, copy)).catch(() => {});
                    }
                    return resp;
                });
            })
        );
        return;
    }

    // Network-first pour le reste
    event.respondWith(
        fetch(req)
            .then((resp) => {
                if (resp.ok && resp.status === 200) {
                    const copy = resp.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
                }
                return resp;
            })
            .catch(() => caches.match(req).then((c) => c || caches.match('index.html')))
    );
});
