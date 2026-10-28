/**
 * Signaling only. File bytes travel peer-to-peer over WebRTC, including
 * between different networks when ICE can establish a direct route.
 */

const CODE_CHARS = "0123456789";
const ROOM_TTL_MS = 15 * 60 * 1000;
const POLL_MS = 15_000;
const MAX_PAYLOAD = 32 * 1024;
const DEVICE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_RETENTION_MS = 120_000;
const memoryRooms = new Map();
const memoryDevices = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function generateCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
}

function createState(code) {
  return {
    code,
    createdAt: Date.now(),
    seq: 0,
    present: { sender: false, receiver: false },
    queues: { sender: [], receiver: [] },
    waiters: { sender: [], receiver: [] },
  };
}

function pruneRooms() {
  const now = Date.now();
  for (const [code, room] of memoryRooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      room.waiters.sender.splice(0).forEach((wake) => wake());
      room.waiters.receiver.splice(0).forEach((wake) => wake());
      memoryRooms.delete(code);
    }
  }
}

function getMemoryRoom(code, create = false) {
  pruneRooms();
  let room = memoryRooms.get(code);
  if (!room && create) {
    room = createState(code);
    memoryRooms.set(code, room);
  }
  return room;
}

function peerOf(role) {
  return role === "sender" ? "receiver" : "sender";
}

function wake(room, role) {
  room.waiters[role].splice(0).forEach((fn) => fn());
}

async function pollRoom(room, role, after, signal) {
  const deadline = Date.now() + POLL_MS;
  while (Date.now() < deadline) {
    const messages = room.queues[role].filter((message) => message.id > after);
    if (messages.length) {
      return json({
        messages: messages.map(({ id, payload }) => ({ id, payload })),
        next: messages[messages.length - 1].id,
      });
    }
    if (signal?.aborted) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(1000, deadline - Date.now()));
      const wakeFn = () => {
        clearTimeout(timer);
        resolve();
      };
      room.waiters[role].push(wakeFn);
      signal?.addEventListener("abort", wakeFn, { once: true });
    });
  }
  return json({ messages: [], next: after });
}

function push(room, from, payload) {
  const to = peerOf(from);
  room.seq += 1;
  room.queues[to].push({ id: room.seq, payload });
  if (room.queues[to].length > 40) room.queues[to].splice(0, room.queues[to].length - 40);
  wake(room, to);
}

async function handleRoom(room, request, url, code) {
  if (!room) return json({ error: "このコードの部屋は見つかりません。受信側の画面を開いたままにしてください。" }, 404);

  if (url.pathname.endsWith("/join") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const role = body.role === "sender" ? "sender" : body.role === "receiver" ? "receiver" : null;
    if (!role) return json({ error: "role が不正です" }, 400);
    room.present[role] = true;
    push(room, role, { kind: "peer-joined", role });
    return json({ ok: true, code, present: room.present });
  }

  if (url.pathname.endsWith("/signal") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const from = body.from === "sender" ? "sender" : body.from === "receiver" ? "receiver" : null;
    if (!from) return json({ error: "from が不正です" }, 400);
    const encoded = JSON.stringify(body.payload ?? {});
    if (encoded.length > MAX_PAYLOAD) return json({ error: "シグナルが大きすぎます" }, 413);
    push(room, from, body.payload ?? {});
    return json({ ok: true });
  }

  if (url.pathname.endsWith("/poll") && request.method === "GET") {
    const role = url.searchParams.get("role");
    if (role !== "sender" && role !== "receiver") return json({ error: "role が不正です" }, 400);
    const after = Number(url.searchParams.get("after") || 0);
    return pollRoom(room, role, Number.isFinite(after) ? after : 0, request.signal);
  }

  return json({ error: "not found" }, 404);
}

export class TransferRoom {
  constructor(state) {
    this.state = state;
    const code = state.id.toString();
    this.room = createState(code);
    this.ready = state.storage.get("room").then((saved) => {
      if (saved) {
        this.room = {
          ...createState(code),
          ...saved,
          waiters: { sender: [], receiver: [] },
        };
      }
    });
  }

  persist() {
    const { code, createdAt, seq, present, queues } = this.room;
    return this.state.storage.put("room", { code, createdAt, seq, present, queues });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (request.headers.get("x-room-init") === "1") {
      this.room = createState(request.headers.get("x-room-code") || this.room.code);
      await this.persist();
      return json({ ok: true, code: this.room.code });
    }
    const response = await handleRoom(this.room, request, url, this.room.code);
    if (request.method === "POST") await this.persist();
    return response;
  }
}

function cleanDeviceName(value) {
  return String(value || "この端末").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 32) || "この端末";
}

function networkKey(request) {
  const publicAddress = request.headers.get("cf-connecting-ip");
  if (publicAddress) {
    const ipv4 = publicAddress.replace(/^::ffff:/i, "");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)) return `public-v4:${ipv4}`;
    const ipv6 = ipv6Prefix64(publicAddress);
    return `public-v6:${ipv6}`;
  }
  return request.headers.get("x-OneSend-network") || "local";
}

function ipv6Prefix64(address) {
  const segments = address.toLowerCase().split("::");
  const left = segments[0].split(":").filter(Boolean);
  const right = (segments[1] || "").split(":").filter(Boolean);
  const missing = Math.max(0, 8 - left.length - right.length);
  return [...left, ...Array(missing).fill("0"), ...right]
    .slice(0, 4)
    .map((part) => Number.parseInt(part || "0", 16).toString(16))
    .join(":");
}

function cleanDirectory(records) {
  const now = Date.now();
  for (const [id, device] of Object.entries(records)) {
    if (now - device.updatedAt > DEVICE_TTL_MS) {
      delete records[id];
      continue;
    }
    device.requests = (device.requests || []).filter((item) => now - item.createdAt <= REQUEST_RETENTION_MS);
    for (const item of device.requests) {
      if (item.status === "pending" && now - item.createdAt >= REQUEST_TIMEOUT_MS) item.status = "expired";
    }
  }
  return records;
}

async function handleDirectory(request, url, storage) {
  const records = cleanDirectory(await storage.get());
  const parts = url.pathname.split("/").filter(Boolean);
  const deviceId = parts[2] ? decodeURIComponent(parts[2]) : "";
  const requestId = parts[4] ? decodeURIComponent(parts[4]) : "";

  if (parts.length === 2 && request.method === "GET") {
    const excludeProfile = url.searchParams.get("excludeProfile") || "";
    const devices = Object.values(records)
      .filter((device) => device.networkKey === networkKey(request) && device.profileId !== excludeProfile && device.available)
      .map(({ id, name, pinRequired, updatedAt }) => ({ id, name, pinRequired, updatedAt }));
    await storage.set(records);
    return json({ devices });
  }

  if (parts.length === 2 && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    const profileId = String(body.profileId || "");
    const code = String(body.code || "").toUpperCase();
    const secret = String(body.secret || "");
    if (!/^[A-Z0-9_-]{8,80}$/i.test(id) || !/^[a-f0-9]{32,128}$/i.test(profileId) || !/^\d{6}$/.test(code) || !/^[a-f0-9]{32,128}$/i.test(secret)) {
      return json({ error: "端末情報が不正です" }, 400);
    }
    const prior = records[id];
    if (prior && prior.secret !== secret) {
      return json({ error: "この端末IDは別の受信セッションが使用中です" }, 409);
    }
    records[id] = {
      id,
      profileId,
      secret,
      name: cleanDeviceName(body.name),
      code,
      pinRequired: Boolean(body.pinRequired),
      available: body.available !== false,
      networkKey: networkKey(request),
      updatedAt: Date.now(),
      requests: prior?.requests || [],
    };
    await storage.set(records);
    return json({ ok: true });
  }

  const device = records[deviceId];
  if (!device || device.networkKey !== networkKey(request)) {
    return json({ error: "受信端末がオフラインか、接続可能な部屋がありません" }, 404);
  }
  const authorization = request.headers.get("authorization") || "";
  const receiverAuthorized = authorization === `Bearer ${device.secret}`;

  if (parts.length === 3 && request.method === "DELETE") {
    if (!receiverAuthorized) return json({ error: "受信端末の認証が必要です" }, 403);
    delete records[deviceId];
    await storage.set(records);
    return json({ ok: true });
  }

  if (parts.length === 4 && parts[3] === "requests" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const requesterSecret = String(body.requesterSecret || "");
    if (!/^[a-f0-9]{32,128}$/i.test(requesterSecret)) {
      return json({ error: "接続要求の識別情報が不正です" }, 400);
    }
    if (!device.available) return json({ error: "この端末は別の転送に対応中です" }, 409);
    if (device.requests.filter((item) => item.status === "pending").length >= 8) {
      return json({ error: "この端末への接続要求が混み合っています" }, 429);
    }
    const id = globalThis.crypto.randomUUID();
    device.requests.push({
      id,
      senderName: cleanDeviceName(body.senderName),
      files: Array.isArray(body.files) ? body.files.slice(0, 50).map((file) => ({ name: String(file.name || "file").slice(0, 255), size: Math.max(0, Number(file.size) || 0) })) : [],
      fileCount: Math.max(0, Math.min(10_000, Number(body.fileCount) || 0)),
      totalBytes: Math.max(0, Number(body.totalBytes) || 0),
      contentType: ["text", "mixed"].includes(body.contentType) ? body.contentType : "files",
      textLength: Math.max(0, Number(body.textLength) || 0),
      requesterSecret,
      status: "pending",
      createdAt: Date.now(),
    });
    await storage.set(records);
    return json({ requestId: id }, 201);
  }

  if (parts.length === 4 && parts[3] === "requests" && request.method === "GET") {
    if (!receiverAuthorized) return json({ error: "受信端末の認証が必要です" }, 403);
    await storage.set(records);
    return json({ requests: device.requests
      .filter((item) => item.status === "pending" || item.status === "expired")
      .map(({ id, senderName, files, fileCount, totalBytes, contentType, textLength, status, createdAt }) => ({ id, senderName, files, fileCount, totalBytes, contentType, textLength, status, createdAt })) });
  }

  if (parts.length === 5 && parts[3] === "requests") {
    const item = device.requests.find((candidate) => candidate.id === requestId);
    if (!item) return json({ status: "expired" });
    if (item.status === "pending" && Date.now() - item.createdAt >= REQUEST_TIMEOUT_MS) item.status = "expired";
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (item.status !== "pending") return json({ error: "接続要求はすでに処理されています" }, 409);
      if (body.cancel === true) {
        if (authorization !== `Bearer ${item.requesterSecret}`) {
          return json({ error: "送信端末の認証が必要です" }, 403);
        }
        item.status = "canceled";
      } else {
        if (!receiverAuthorized) return json({ error: "受信端末の認証が必要です" }, 403);
        item.status = body.accepted === true ? "accepted" : "rejected";
      }
      item.decidedAt = Date.now();
      if (item.status === "accepted") {
        device.available = false;
        device.requests.forEach((other) => {
          if (other.id !== item.id && other.status === "pending") {
            other.status = "busy";
            other.decidedAt = Date.now();
          }
        });
      }
      device.updatedAt = Date.now();
      await storage.set(records);
      return json({ ok: true });
    }
    if (request.method === "GET") {
      if (item.status === "accepted") {
        await storage.set(records);
        return json({ status: item.status, code: device.code, pinRequired: device.pinRequired });
      }
      await storage.set(records);
      return json({ status: item.status });
    }
  }

  return json({ error: "not found" }, 404);
}

export class DeviceDirectory {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    return handleDirectory(request, new URL(request.url), {
      get: () => this.state.storage.get("devices").then((value) => value || {}),
      set: (value) => this.state.storage.put("devices", value),
    });
  }
}

async function route(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (url.pathname.startsWith("/api/devices")) {
    if (env?.DEVICES) {
      const directory = env.DEVICES.get(env.DEVICES.idFromName("active-devices"));
      return directory.fetch(request);
    }
    return handleDirectory(request, url, {
      get: async () => Object.fromEntries(memoryDevices),
      set: async (value) => {
        memoryDevices.clear();
        Object.entries(value).forEach(([id, device]) => memoryDevices.set(id, device));
      },
    });
  }

  if (url.pathname === "/api/rooms" && request.method === "POST") {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateCode();
      if (env?.ROOMS) {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const init = await stub.fetch(new Request(url.origin + `/api/rooms/${code}/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-room-init": "1",
            "x-room-code": code,
          },
          body: JSON.stringify({ role: "receiver" }),
        }));
        if (!init.ok) continue;
        return json({ code });
      }
      if (!getMemoryRoom(code)) {
        const room = getMemoryRoom(code, true);
        room.present.receiver = true;
        return json({ code });
      }
    }
    return json({ error: "部屋を作れませんでした" }, 500);
  }

  const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|signal|poll))?$/);
  if (!match) return json({ error: "not found" }, 404);
  const code = match[1].toUpperCase();

  if (env?.ROOMS) {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  }
  return handleRoom(getMemoryRoom(code), request, url, code);
}

export default {
  async fetch(request, env) {
    const api = await route(request, env);
    if (api) return api;
    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response("OneSend is a static site plus a signaling API. Use npm start or Cloudflare Workers.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
