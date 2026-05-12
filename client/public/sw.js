/**
 * Synthstudio – Service Worker (PWA Offline Support)
 *
 * Strategie: Cache-First für Assets, Network-First für API-Calls.
 * Gecachte Ressourcen: App Shell (HTML/JS/CSS), statische Assets.
 */

const CACHE_NAME = "synthstudio-v1.14";
const STATIC_ASSETS = [
  "./",
  "./index.html",
];

// ── Install: App Shell cachen ───────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] App Shell gecacht");
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn("[SW] Teile konnten nicht gecacht werden:", err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: Alte Caches aufräumen ────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log("[SW] Alter Cache gelöscht:", k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: Cache-First für statische Assets ─────────────────────────────────

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API-Calls (Anthropic, etc.) immer vom Netzwerk
  if (url.hostname !== self.location.hostname) {
    return; // Kein Intercept für externe Requests
  }

  // Audio-Dateien und Blobs: direkt vom Netzwerk/Cache
  if (event.request.url.startsWith("blob:") || event.request.url.startsWith("data:")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Nur GET-Requests und 200er cachen
          if (event.request.method !== "GET" || !response || response.status !== 200) {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline-Fallback: App Shell zurückgeben
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("Offline", { status: 503 });
        });
    })
  );
});

// ── Hintergrund-Sync (optional) ────────────────────────────────────────────

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
