const DEFAULT_PUBLIC_ORIGIN = "https://1.max7.work";
const SUPPORTED_PUBLIC_HOSTS = new Set(["1.max7.work", "1lk.f5.si"]);
const STORAGE_KEY = "OneCode-pending";
const RESERVED = new Set([
  "css",
  "js",
  "index",
  "index.html",
  "404",
  "404.html",
  "links.json",
  "cname",
  "favicon.ico",
  "robots.txt",
  "demo",
  "og.png",
]);

const FLAG_HTTP = 1;
const FLAG_WWW = 2;
const FLAG_ROOT = 4;
const FLAG_COMPRESSED = 128;

function bytesToBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function compressBytes(bytes) {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressBytes(bytes) {
  if (typeof DecompressionStream !== "function") return null;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function packUrlParts(urlString) {
  const u = new URL(urlString);
  let flags = 0;
  if (u.protocol === "http:") flags |= FLAG_HTTP;

  let host = u.hostname;
  if (host.startsWith("www.")) {
    flags |= FLAG_WWW;
    host = host.slice(4);
  }

  const authority = u.port ? `${host}:${u.port}` : host;
  const path = `${u.pathname}${u.search}${u.hash}`;

  if (path === "/") {
    flags |= FLAG_ROOT;
    return { flags, body: new TextEncoder().encode(authority) };
  }

  const body = new TextEncoder().encode(`${authority}\0${path}`);
  return { flags, body };
}

function unpackUrlParts(flags, bodyBytes) {
  const text = new TextDecoder().decode(bodyBytes);
  const scheme = flags & FLAG_HTTP ? "http" : "https";
  const www = flags & FLAG_WWW ? "www." : "";

  if (flags & FLAG_ROOT) {
    if (!text) return null;
    return normalizeUrl(`${scheme}://${www}${text}/`);
  }

  const sep = text.indexOf("\0");
  if (sep < 0) return null;

  const authority = text.slice(0, sep);
  if (!authority) return null;

  let path = text.slice(sep + 1);
  if (!path) path = "/";
  else if (!path.startsWith("/") && !path.startsWith("?") && !path.startsWith("#")) {
    path = `/${path}`;
  }

  return normalizeUrl(`${scheme}://${www}${authority}${path}`);
}

export function publicOrigin() {
  if (typeof location !== "undefined") {
    const hostname = location.hostname.toLowerCase();
    if (
      SUPPORTED_PUBLIC_HOSTS.has(hostname) ||
      /^(localhost|127\.0\.0\.1)$/i.test(hostname)
    ) {
      return location.origin;
    }
  }
  return DEFAULT_PUBLIC_ORIGIN;
}

export function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isValidCode(code) {
  return (
    /^[a-zA-Z0-9]{1,6}$/.test(code) && !RESERVED.has(code.toLowerCase())
  );
}

export async function encodeDestination(url) {
  const { flags, body } = packUrlParts(url);
  const candidates = [];

  const build = (outFlags, payload) => {
    const bytes = new Uint8Array(1 + payload.length);
    bytes[0] = outFlags;
    bytes.set(payload, 1);
    return bytesToBase64Url(bytes);
  };

  candidates.push(build(flags, body));

  const compressed = await compressBytes(body);
  if (compressed && compressed.length < body.length) {
    candidates.push(build(flags | FLAG_COMPRESSED, compressed));
  }

  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

async function decodePacked(payload) {
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || payload.length < 4) return null;

  const bytes = base64UrlToBytes(payload);
  if (bytes.length < 2) return null;

  const flags = bytes[0];
  const known = FLAG_HTTP | FLAG_WWW | FLAG_ROOT | FLAG_COMPRESSED;
  if (flags & ~known) return null;

  let body = bytes.slice(1);
  if (flags & FLAG_COMPRESSED) {
    body = (await decompressBytes(body)) || null;
    if (!body) return null;
  }
  return unpackUrlParts(flags & ~FLAG_COMPRESSED, body);
}

/** Legacy `/~u…` / `/~z…` payloads from the previous encoder. */
async function decodeLegacy(payload) {
  if (!payload || payload.length < 2) return null;
  const kind = payload[0];
  const body = payload.slice(1);
  if (kind !== "u" && kind !== "z") return null;

  try {
    const bytes = base64UrlToBytes(body);
    let decoded = bytes;
    if (kind === "z") {
      decoded = (await decompressBytes(bytes)) || bytes;
    }
    return normalizeUrl(new TextDecoder().decode(decoded));
  } catch {
    return null;
  }
}

export async function decodeDestination(payload) {
  if (!payload) return null;

  try {
    const packed = await decodePacked(payload);
    if (packed) return packed;
  } catch {
    // try legacy next
  }

  try {
    return await decodeLegacy(payload);
  } catch {
    return null;
  }
}

export async function loadLinks() {
  const res = await fetch("/links.json", { cache: "no-store" });
  if (!res.ok) return {};
  const data = await res.json();
  return data && typeof data === "object" ? data : {};
}

export function loadPending() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePending(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function mergeLinks(published, pending) {
  return { ...published, ...pending };
}

export function shortUrlFor(code) {
  return `${publicOrigin()}/${code}`;
}

export function instantShortUrl(payload) {
  return `${publicOrigin()}/${payload}`;
}

export function instantShortUrlWithPath(payload) {
  return instantShortUrl(payload);
}

export function redirectHtml(destination) {
  const safe = destination
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${safe}">
  <link rel="canonical" href="${safe}">
  <title>Redirecting…</title>
  <script>location.replace(${JSON.stringify(destination)});</script>
</head>
<body>
  <p>Redirecting to <a href="${safe}">${safe}</a>…</p>
</body>
</html>
`;
}

export { DEFAULT_PUBLIC_ORIGIN };
