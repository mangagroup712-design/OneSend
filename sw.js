const VERSION = "v11";
const CACHE = `OneSend-${VERSION}`;
const SHELL = [
  "/", "/send.html", "/receive.html", "/404.html",
  "/css/main.css",
  "/js/client.js", "/js/read.js", "/js/signal.js", "/js/peer.js", "/js/pwa.js",
  "/manifest.json", "/manifest.webmanifest", "/favicon.ico",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
];
const RUNTIME_ORIGINS = [
  "https://cdn.jsdelivr.net",
];

const clean = async (res) =>
  res.redirected
    ? new Response(await res.blob(), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    : res;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(async (path) => {
      const res = await fetch(path, { cache: "reload" });
      if (res.ok) await cache.put(path, await clean(res));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, (await clean(res)).clone());
    return res;
  } catch {
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match("/")) ||
      Response.error()
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request)
    .then(async (res) => {
      if (res.ok) await cache.put(request, (await clean(res)).clone());
      return res;
    })
    .catch(() => hit);
  return hit || update;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const shareUrl = new URL(req.url);
  if (req.method === "POST" && shareUrl.origin === self.location.origin && shareUrl.pathname === "/share-target") {
    event.respondWith(handleSharePost(req));
    return;
  }
  if (req.method !== "GET" || req.headers.has("range")) return;
  const requestUrl = new URL(req.url);
  if (requestUrl.pathname.startsWith("/api/")) return;
  if (requestUrl.origin !== self.location.origin && !RUNTIME_ORIGINS.includes(requestUrl.origin)) return;

  event.respondWith(
    req.mode === "navigate" ? networkFirst(req) : staleWhileRevalidate(req),
  );
});

async function handleSharePost(request) {
  const form = await request.formData();
  const payload = {
    title: String(form.get("title") || "").slice(0, 500),
    text: String(form.get("text") || "").slice(0, 10000),
    url: String(form.get("url") || "").slice(0, 4000),
    files: form.getAll("files").filter((value) => value instanceof File).map((file) => ({ name: file.name, type: file.type, blob: file })),
  };
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("payload", "readwrite");
    tx.objectStore("payload").put(payload, "latest");
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  return Response.redirect(new URL("/send.html?share=1", request.url), 303);
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("OneSend-share", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("payload");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
