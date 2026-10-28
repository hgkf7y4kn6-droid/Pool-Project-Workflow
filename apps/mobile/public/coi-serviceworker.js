/*
 * Cross-origin isolation for hosts that can't set response headers.
 *
 * The web build's SQLite worker needs SharedArrayBuffer, which browsers only
 * expose when the page is served with COOP/COEP headers. When the host sets
 * them (render.yaml) this worker is never registered; otherwise it adds them
 * to the app's own same-origin responses. Cross-origin requests (the API,
 * Supabase signed URLs) pass through untouched.
 */
// Safari only supports require-corp; credentialless keeps cross-origin images working elsewhere.
const coep = /Chrome|Firefox/.test(self.navigator.userAgent) ? "credentialless" : "require-corp";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Embedder-Policy", coep);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }),
  );
});
