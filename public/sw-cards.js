// Service worker for aggressive long-term caching of Scryfall card images.
// Card image URLs are content-addressed by Scryfall ID and are effectively
// immutable, so we use a cache-first strategy with no expiry.
const CACHE_NAME = "tolaria-card-images-v1";
const CARD_HOSTS = new Set(["cards.scryfall.io"]);

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(
                        (k) =>
                            k.startsWith("tolaria-card-images-") &&
                            k !== CACHE_NAME
                    )
                    .map((k) => caches.delete(k))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    let url;
    try {
        url = new URL(req.url);
    } catch {
        return;
    }
    if (!CARD_HOSTS.has(url.hostname)) return;

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(req);
            if (cached) return cached;
            try {
                const response = await fetch(req);
                if (response && response.status === 200) {
                    cache.put(req, response.clone());
                }
                return response;
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
        })()
    );
});
