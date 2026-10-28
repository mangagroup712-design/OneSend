import http from "node:http";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

globalThis.crypto ||= webcrypto;
const { default: worker } = await import("./worker.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(status, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  if (res.req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }).pipe(res);
}

function localNetworkKey(address) {
  const normalized = address.replace(/^::ffff:/i, "").toLowerCase();
  const ipv4 = normalized.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4) {
    const toNumber = (value) => value.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
    const toAddress = (value) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
    const remote = toNumber(ipv4[1]);
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const network of addresses || []) {
        if (network.family !== "IPv4" || !network.netmask) continue;
        const mask = toNumber(network.netmask);
        const local = toNumber(network.address);
        if ((remote & mask) === (local & mask)) {
          const prefix = mask.toString(2).replace(/0/g, "").length;
          return `lan-v4:${toAddress(remote & mask)}/${prefix}`;
        }
      }
    }
    const fallbackPrefix = ipv4[1].split(".").slice(0, 3).join(".");
    return `lan-v4:${fallbackPrefix}.0/24`;
  }
  const halves = normalized.split("::");
  const left = halves[0].split(":").filter(Boolean);
  const right = (halves[1] || "").split(":").filter(Boolean);
  const expanded = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `lan-v6:${expanded.slice(0, 4).join(":")}`;
}

async function proxyWorker(req, res) {
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.delete("cf-connecting-ip");
  forwardedHeaders.set("x-OneSend-network", localNetworkKey(req.socket.remoteAddress || "local"));
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: forwardedHeaders,
    body,
  });
  const response = await worker.fetch(request, {});
  res.writeHead(response.status, Object.fromEntries(response.headers));
  const responseBody = Buffer.from(await response.arrayBuffer());
  res.end(responseBody);
}

const server = http.createServer(async (req, res) => {
  if ((req.url || "").split("?")[0].startsWith("/api/")) {
    try {
      await proxyWorker(req, res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(root, `.${path.sep}${safe.replace(/^[/\\]+/, "")}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (safe.endsWith("/") || !path.extname(safe)) {
    const asIndex = path.join(filePath, "index.html");
    if (fs.existsSync(asIndex)) {
      send(res, 200, asIndex);
      return;
    }
    if (!path.extname(safe) && fs.existsSync(`${filePath}.html`)) {
      send(res, 200, `${filePath}.html`);
      return;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    send(res, 200, filePath);
    return;
  }

  if (!safe.includes("/") && !path.extname(safe)) {
    try {
      await proxyWorker(req, res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message);
    }
    return;
  }

  // GitHub Pages / Cloudflare Pages と同じく、無いパスは 404.html を返す
  const fallback = path.join(root, "404.html");
  send(res, 404, fallback);
});

server.listen(port, host, () => {
  console.log(`OneSend local server: http://localhost:${port}`);
  const addresses = Object.values(os.networkInterfaces()).flatMap((items) =>
    (items || []).filter((item) => item.family === "IPv4" && !item.internal).map((item) => item.address),
  );
  if (addresses.length) {
    addresses.forEach((address) => console.log(`LAN access: http://${address}:${port}`));
  } else {
    console.log(`LAN access: http://<this-pc-ip>:${port}`);
  }
});
