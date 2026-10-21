"use strict";

const CACHE_NAME = "atrivobank-network-v1";
const APP_SHELL = [
  "./",
  "./index.htm",
  "./app.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./static/icone-256.png",
  "./static/icone-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name.startsWith("atrivobank-") && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    const isAppAsset = request.mode === "navigate" ||
      ["document", "script", "style", "image", "font"].includes(request.destination);

    if (isAppAsset && (response.ok || response.type === "opaque")) {
      await cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const appShell = await cache.match("./index.htm");
      if (appShell) return appShell;
    }

    throw error;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || !["http:", "https:"].includes(new URL(request.url).protocol)) return;

  event.respondWith(networkFirst(request));
});
