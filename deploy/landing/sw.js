/* Kill-switch: la racine du site n'est plus le jeu mais la page des versions.
   Ce SW remplace l'ancien SW racine (scope /), purge ses caches et se
   desinstalle. Les jeux /v1 /v2 /v3 ont leurs propres SW a leur scope. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.navigate(c.url));
    })());
});
