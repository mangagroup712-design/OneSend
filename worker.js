/**
 * Signaling only. File bytes travel peer-to-peer over WebRTC, including
 * between different networks when ICE can establish a direct route.
 */

<<<<<<< HEAD
=======
const CODE_LENGTH = 6;
>>>>>>> 2e67a06 (最適化)
const CODE_CHARS = "0123456789";
const ROOM_TTL_MS = 15 * 60 * 1000;
const POLL_MS = 15_000;
const MAX_PAYLOAD = 32 * 1024;
const DEVICE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_RETENTION_MS = 120_000;
const memoryRooms = new Map();
const memoryDevices = new Map();
<<<<<<< HEAD
=======
const memoryRateLimits = new Map();
const CREATE_LIMIT = 6;
const JOIN_FAILURE_LIMIT = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ICE_LIMIT = 20;
const TURN_TTL_SECONDS = 3600;
const TURN_TIMEOUT_MS = 3000;
const MAX_JSON_BODY_BYTES = 256 * 1024;
>>>>>>> 2e67a06 (最適化)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

<<<<<<< HEAD
function generateCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
=======
async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return { error: json({ error: "リクエストが大きすぎます" }, 413) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    return { error: json({ error: "リクエストが大きすぎます" }, 413) };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: "JSONが不正です" }, 400) };
  }
}

function generateCode() {
  const limit = 256 - (256 % CODE_CHARS.length);
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of globalThis.crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit) code += CODE_CHARS[byte % CODE_CHARS.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

function randomToken() {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
>>>>>>> 2e67a06 (最適化)
}

function createState(code) {
  return {
    code,
<<<<<<< HEAD
    createdAt: Date.now(),
    seq: 0,
    present: { sender: false, receiver: false },
    names: { sender: "", receiver: "" },
=======
    initialized: true,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    seq: 0,
    present: { sender: false, receiver: false },
    names: { sender: "", receiver: "" },
    tokens: { sender: "", receiver: "" },
>>>>>>> 2e67a06 (最適化)
    queues: { sender: [], receiver: [] },
    waiters: { sender: [], receiver: [] },
  };
}

<<<<<<< HEAD
function pruneRooms() {
  const now = Date.now();
  for (const [code, room] of memoryRooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      room.waiters.sender.splice(0).forEach((wake) => wake());
      room.waiters.receiver.splice(0).forEach((wake) => wake());
=======
function emptyRoom(code) {
  return { ...createState(code), initialized: false, createdAt: 0, lastActivity: 0 };
}

function roomExpired(room, now = Date.now()) {
  return !room?.initialized || now - room.lastActivity >= ROOM_TTL_MS;
}

function invalidateRoom(room) {
  room.waiters.sender.splice(0).forEach((wake) => wake());
  room.waiters.receiver.splice(0).forEach((wake) => wake());
  room.initialized = false;
}

function pruneRooms() {
  const now = Date.now();
  for (const [code, room] of memoryRooms) {
    if (roomExpired(room, now)) {
      invalidateRoom(room);
>>>>>>> 2e67a06 (最適化)
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

<<<<<<< HEAD
=======
function validRole(role) { return role === "sender" || role === "receiver"; }
function tokenFrom(request) {
  return /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
}
function authorized(room, request, role) {
  return validRole(role) && Boolean(room.tokens[role]) && tokenFrom(request) === room.tokens[role];
}
function touch(room) { room.lastActivity = Date.now(); }

>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
  if (!room) return json({ error: "このコードの部屋は見つかりません。受信側の画面を開いたままにしてください。" }, 404);

  if (url.pathname.endsWith("/join") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const role = body.role === "sender" ? "sender" : body.role === "receiver" ? "receiver" : null;
    if (!role) return json({ error: "role が不正です" }, 400);
    room.present[role] = true;
    room.names ||= { sender: "", receiver: "" };
    room.names[role] = cleanRoomPeerName(body.name);
    push(room, role, { kind: "peer-joined", role, name: room.names[role] });
    return json({ ok: true, code, present: room.present, peerName: room.names[peerOf(role)] || "" });
=======
  if (!room || roomExpired(room)) return json({ error: "このコードの部屋は見つからないか、有効期限が切れています。" }, 404);

  if (url.pathname.endsWith("/join") && request.method === "POST") {
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "JSONが不正です" }, 400);
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 32)) {
      return json({ error: "端末名が長すぎます" }, 400);
    }
    const role = validRole(body.role) ? body.role : null;
    if (!role) return json({ error: "role が不正です" }, 400);
    if (room.tokens[role]) return json({ error: "この役割はすでに参加しています。" }, 409);
    const token = randomToken();
    room.tokens[role] = token;
    room.present[role] = true;
    room.names ||= { sender: "", receiver: "" };
    room.names[role] = cleanRoomPeerName(body.name);
    touch(room);
    push(room, role, { kind: "peer-joined", role, name: room.names[role] });
    return json({ ok: true, code, token, present: room.present, peerName: room.names[peerOf(role)] || "" });
>>>>>>> 2e67a06 (最適化)
  }

  function cleanRoomPeerName(value) {
    return String(value || "接続端末").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 32) || "接続端末";
  }

  if (url.pathname.endsWith("/signal") && request.method === "POST") {
<<<<<<< HEAD
    const body = await request.json().catch(() => ({}));
    const from = body.from === "sender" ? "sender" : body.from === "receiver" ? "receiver" : null;
    if (!from) return json({ error: "from が不正です" }, 400);
    const encoded = JSON.stringify(body.payload ?? {});
    if (encoded.length > MAX_PAYLOAD) return json({ error: "シグナルが大きすぎます" }, 413);
=======
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "JSONが不正です" }, 400);
    const from = validRole(body.from) ? body.from : null;
    if (!from) return json({ error: "from が不正です" }, 400);
    if (!authorized(room, request, from)) return json({ error: "部屋への認証が必要です" }, 401);
    const encoded = JSON.stringify(body.payload ?? {});
    if (new TextEncoder().encode(encoded).byteLength > MAX_PAYLOAD) return json({ error: "シグナルが大きすぎます" }, 413);
    touch(room);
>>>>>>> 2e67a06 (最適化)
    push(room, from, body.payload ?? {});
    return json({ ok: true });
  }

  if (url.pathname.endsWith("/poll") && request.method === "GET") {
    const role = url.searchParams.get("role");
<<<<<<< HEAD
    if (role !== "sender" && role !== "receiver") return json({ error: "role が不正です" }, 400);
    const after = Number(url.searchParams.get("after") || 0);
    return pollRoom(room, role, Number.isFinite(after) ? after : 0, request.signal);
=======
    if (!validRole(role)) return json({ error: "role が不正です" }, 400);
    if (!authorized(room, request, role)) return json({ error: "部屋への認証が必要です" }, 401);
    const after = Number(url.searchParams.get("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0) return json({ error: "after が不正です" }, 400);
    touch(room);
    return pollRoom(room, role, after, request.signal);
  }

  if (url.pathname === `/api/rooms/${code}` && request.method === "DELETE") {
    const role = url.searchParams.get("role");
    if (!authorized(room, request, role)) return json({ error: "部屋への認証が必要です" }, 401);
    if (role !== "receiver") return json({ error: "受信側の認証が必要です" }, 403);
    invalidateRoom(room);
    return json({ ok: true, deleted: true });
>>>>>>> 2e67a06 (最適化)
  }

  return json({ error: "not found" }, 404);
}

export class TransferRoom {
  constructor(state) {
    this.state = state;
    const code = state.id.toString();
<<<<<<< HEAD
    this.room = createState(code);
=======
    this.room = emptyRoom(code);
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
    const { code, createdAt, seq, present, names, queues } = this.room;
    return this.state.storage.put("room", { code, createdAt, seq, present, names, queues });
=======
    const { code, initialized, createdAt, lastActivity, seq, present, names, tokens, queues } = this.room;
    return Promise.all([
      this.state.storage.put("room", { code, initialized, createdAt, lastActivity, seq, present, names, tokens, queues }),
      this.state.storage.setAlarm(this.room.lastActivity + ROOM_TTL_MS),
    ]);
>>>>>>> 2e67a06 (最適化)
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (request.headers.get("x-room-init") === "1") {
<<<<<<< HEAD
=======
      if (this.room.initialized && !roomExpired(this.room)) return json({ error: "この部屋コードは使用中です" }, 409);
>>>>>>> 2e67a06 (最適化)
      this.room = createState(request.headers.get("x-room-code") || this.room.code);
      await this.persist();
      return json({ ok: true, code: this.room.code });
    }
    const response = await handleRoom(this.room, request, url, this.room.code);
<<<<<<< HEAD
    if (request.method === "POST") await this.persist();
    return response;
  }
=======
    if (response.status === 404 && roomExpired(this.room)) {
      invalidateRoom(this.room);
      await this.state.storage.deleteAll();
      this.room = emptyRoom(this.room.code);
    } else if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.clone().json().catch(() => ({}));
      if (body.deleted) {
        await this.state.storage.deleteAll();
        this.room = emptyRoom(this.room.code);
      } else await this.persist();
    }
    return response;
  }

  async alarm() {
    await this.ready;
    if (roomExpired(this.room)) {
      invalidateRoom(this.room);
      await this.state.storage.deleteAll();
      this.room = emptyRoom(this.room.code);
    } else {
      await this.state.storage.setAlarm(this.room.lastActivity + ROOM_TTL_MS);
    }
  }
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
  return request.headers.get("x-OneSend-network") || "local";
=======
  const localNetwork = request.headers.get("x-OneSend-network") || "";
  return /^[A-Za-z0-9._:/-]{1,96}$/.test(localNetwork) ? `local:${localNetwork}` : "local";
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
  const records = cleanDirectory(await storage.get());
=======
  let records = cleanDirectory(await storage.get());
>>>>>>> 2e67a06 (最適化)
  const parts = url.pathname.split("/").filter(Boolean);
  const deviceId = parts[2] ? decodeURIComponent(parts[2]) : "";
  const requestId = parts[4] ? decodeURIComponent(parts[4]) : "";

  if (parts.length === 2 && request.method === "GET") {
    const excludeProfile = url.searchParams.get("excludeProfile") || "";
    const devices = Object.values(records)
      .filter((device) => device.networkKey === networkKey(request) && device.profileId !== excludeProfile && device.available)
      .map(({ id, name, pinRequired, updatedAt }) => ({ id, name, pinRequired, updatedAt }));
<<<<<<< HEAD
    await storage.set(records);
=======
>>>>>>> 2e67a06 (最適化)
    return json({ devices });
  }

  if (parts.length === 2 && request.method === "POST") {
<<<<<<< HEAD
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    const profileId = String(body.profileId || "");
    const code = String(body.code || "").toUpperCase();
    const secret = String(body.secret || "");
=======
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "JSONが不正です" }, 400);
    if (![body.id, body.profileId, body.code, body.secret].every((value) => typeof value === "string")) {
      return json({ error: "端末情報が不正です" }, 400);
    }
    const id = body.id;
    const profileId = body.profileId;
    const code = body.code.toUpperCase();
    const secret = body.secret;
    if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 32)) {
      return json({ error: "端末名が長すぎます" }, 400);
    }
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
    await storage.set(records);
    return json({ ok: true });
  }

  const device = records[deviceId];
=======
    await storage.put(id, records[id]);
    return json({ ok: true });
  }

  let device = records[deviceId];
>>>>>>> 2e67a06 (最適化)
  if (!device || device.networkKey !== networkKey(request)) {
    return json({ error: "受信端末がオフラインか、接続可能な部屋がありません" }, 404);
  }
  const authorization = request.headers.get("authorization") || "";
  const receiverAuthorized = authorization === `Bearer ${device.secret}`;

  if (parts.length === 3 && request.method === "DELETE") {
    if (!receiverAuthorized) return json({ error: "受信端末の認証が必要です" }, 403);
    delete records[deviceId];
<<<<<<< HEAD
    await storage.set(records);
=======
    await storage.delete(deviceId);
>>>>>>> 2e67a06 (最適化)
    return json({ ok: true });
  }

  if (parts.length === 4 && parts[3] === "requests" && request.method === "POST") {
<<<<<<< HEAD
    const body = await request.json().catch(() => ({}));
    const requesterSecret = String(body.requesterSecret || "");
    if (!/^[a-f0-9]{32,128}$/i.test(requesterSecret)) {
=======
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const body = parsed.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "JSONが不正です" }, 400);
    const requesterSecret = body.requesterSecret;
    if (body.senderName !== undefined && (typeof body.senderName !== "string" || body.senderName.length > 32)) {
      return json({ error: "送信端末名が長すぎます" }, 400);
    }
    if (body.files !== undefined && (!Array.isArray(body.files) || body.files.length > 50 || body.files.some((file) =>
      !file || typeof file !== "object" || (file.name !== undefined && (typeof file.name !== "string" || file.name.length > 255)) ||
      typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0))) {
      return json({ error: "ファイル情報が不正です" }, 400);
    }
    if (typeof requesterSecret !== "string" || !/^[a-f0-9]{32,128}$/i.test(requesterSecret)) {
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
    await storage.set(records);
=======
    await storage.put(deviceId, device);
>>>>>>> 2e67a06 (最適化)
    return json({ requestId: id }, 201);
  }

  if (parts.length === 4 && parts[3] === "requests" && request.method === "GET") {
    if (!receiverAuthorized) return json({ error: "受信端末の認証が必要です" }, 403);
<<<<<<< HEAD
    await storage.set(records);
=======
    if (url.searchParams.get("wait") === "1" && !device.requests.some((item) => item.status === "pending")) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      records = cleanDirectory(await storage.get());
      device = records[deviceId] || device;
    }
>>>>>>> 2e67a06 (最適化)
    return json({ requests: device.requests
      .filter((item) => item.status === "pending" || item.status === "expired")
      .map(({ id, senderName, files, fileCount, totalBytes, contentType, textLength, status, createdAt }) => ({ id, senderName, files, fileCount, totalBytes, contentType, textLength, status, createdAt })) });
  }

  if (parts.length === 5 && parts[3] === "requests") {
<<<<<<< HEAD
    const item = device.requests.find((candidate) => candidate.id === requestId);
    if (!item) return json({ status: "expired" });
    if (item.status === "pending" && Date.now() - item.createdAt >= REQUEST_TIMEOUT_MS) item.status = "expired";
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
=======
    let item = device.requests.find((candidate) => candidate.id === requestId);
    if (!item) return json({ status: "expired" });
    const requesterAuthorized = authorization === `Bearer ${item.requesterSecret}`;
    if (request.method === "GET" && !receiverAuthorized && !requesterAuthorized) {
      return json({ error: "接続要求の認証が必要です" }, 403);
    }
    if (item.status === "pending" && Date.now() - item.createdAt >= REQUEST_TIMEOUT_MS) item.status = "expired";
    if (request.method === "POST") {
      const parsed = await readJsonBody(request);
      if (parsed.error) return parsed.error;
      const body = parsed.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "JSONが不正です" }, 400);
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
      await storage.set(records);
      return json({ ok: true });
    }
    if (request.method === "GET") {
      if (item.status === "accepted") {
        await storage.set(records);
        return json({ status: item.status, code: device.code, pinRequired: device.pinRequired });
      }
      await storage.set(records);
=======
      await storage.put(deviceId, device);
      return json({ ok: true });
    }
    if (request.method === "GET") {
      if (url.searchParams.get("wait") === "1" && item.status === "pending") {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        records = cleanDirectory(await storage.get());
        device = records[deviceId] || device;
        item = device.requests.find((candidate) => candidate.id === requestId) || item;
      }
      if (item.status === "accepted") {
        return json({ status: item.status, code: device.code, pinRequired: device.pinRequired });
      }
>>>>>>> 2e67a06 (最適化)
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
<<<<<<< HEAD
    return handleDirectory(request, new URL(request.url), {
      get: () => this.state.storage.get("devices").then((value) => value || {}),
      set: (value) => this.state.storage.put("devices", value),
    });
  }
=======
    const response = await handleDirectory(request, new URL(request.url), {
      get: async () => Object.fromEntries([...await this.state.storage.list({ prefix: "d:" })].map(([key, value]) => [key.slice(2), value])),
      put: async (id, device) => {
        await this.state.storage.put(`d:${id}`, device);
        const records = Object.fromEntries([...await this.state.storage.list({ prefix: "d:" })].map(([key, value]) => [key.slice(2), value]));
        const expires = Object.values(records).map((entry) => entry.updatedAt + DEVICE_TTL_MS);
        if (expires.length) await this.state.storage.setAlarm(Math.min(...expires));
      },
      delete: async (id) => {
        await this.state.storage.delete(`d:${id}`);
        const records = await this.state.storage.list({ prefix: "d:" });
        if (records.size) {
          await this.state.storage.setAlarm(Math.min(...[...records.values()].map((entry) => entry.updatedAt + DEVICE_TTL_MS)));
        } else {
          await this.state.storage.deleteAlarm();
        }
      },
    });
    return response;
  }

  async alarm() {
    const records = cleanDirectory(Object.fromEntries([...await this.state.storage.list({ prefix: "d:" })].map(([key, value]) => [key.slice(2), value])));
    const existing = await this.state.storage.list({ prefix: "d:" });
    await Promise.all([...existing.keys()].filter((key) => !(key.slice(2) in records)).map((key) => this.state.storage.delete(key)));
    const expires = Object.values(records).map((device) => device.updatedAt + DEVICE_TTL_MS);
    if (expires.length) await this.state.storage.setAlarm(Math.min(...expires));
    else await this.state.storage.deleteAlarm();
  }
}

export class RoomRateLimiter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const parsed = await readJsonBody(request);
    if (parsed.error) return parsed.error;
    const { kind } = parsed.body || {};
    if (!["create", "join-failure", "ice"].includes(kind)) return json({ error: "制限種別が不正です" }, 400);
    const field = kind === "create" ? "created" : kind === "ice" ? "ice" : "failures";
    const limit = kind === "create" ? CREATE_LIMIT : kind === "ice" ? ICE_LIMIT : JOIN_FAILURE_LIMIT;
    const now = Date.now();
    const times = (await this.state.storage.get(field) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
    if (times.length >= limit) return json({ error: "試行回数が多すぎます。少し待ってからもう一度お試しください。" }, 429);
    times.push(now);
    await this.state.storage.put(field, times);
    await this.state.storage.setAlarm(now + RATE_LIMIT_WINDOW_MS);
    return json({ ok: true });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}

async function rateLimit(request, env, kind) {
  const key = networkKey(request);
  if (env?.ROOM_RATE_LIMITS) {
    const stub = env.ROOM_RATE_LIMITS.get(env.ROOM_RATE_LIMITS.idFromName(key));
    return stub.fetch(new Request("https://rate-limit.internal/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
    }));
  }
  const now = Date.now();
  const entry = memoryRateLimits.get(key) || { created: [], failures: [], ice: [] };
  const field = kind === "create" ? "created" : kind === "ice" ? "ice" : "failures";
  const limit = kind === "create" ? CREATE_LIMIT : kind === "ice" ? ICE_LIMIT : JOIN_FAILURE_LIMIT;
  entry[field] = entry[field].filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (entry[field].length >= limit) return json({ error: "試行回数が多すぎます。少し待ってからもう一度お試しください。" }, 429);
  entry[field].push(now);
  memoryRateLimits.set(key, entry);
  return json({ ok: true });
>>>>>>> 2e67a06 (最適化)
}

async function route(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
<<<<<<< HEAD

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
=======
  // Initialization is an internal Worker-to-DO protocol, never a public API.
  if (request.headers.get("x-room-init") === "1") return json({ error: "not found" }, 404);

  if (url.pathname === "/api/devices" || url.pathname.startsWith("/api/devices/")) {
    if (env?.DEVICES) {
      const directory = env.DEVICES.get(env.DEVICES.idFromName(networkKey(request)));
      return directory.fetch(request);
    }
    return handleDirectory(request, url, {
      get: async () => {
        const records = cleanDirectory(Object.fromEntries(memoryDevices));
        for (const id of memoryDevices.keys()) {
          if (!records[id]) memoryDevices.delete(id);
        }
        return records;
      },
      put: async (id, device) => memoryDevices.set(id, device),
      delete: async (id) => memoryDevices.delete(id),
    });
  }

  if (url.pathname === "/api/ice" && request.method === "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "許可されていないオリジンです" }, 403);
    const limited = await rateLimit(request, env, "ice");
    if (!limited.ok) return limited;
    const stun = [{ urls: "stun:stun.l.google.com:19302" }];
    if (!env?.TURN_KEY_ID || !env?.TURN_KEY_API_TOKEN) return json({ iceServers: stun, turn: false });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    try {
      const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }), signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      const iceServers = Array.isArray(data.iceServers)
        ? data.iceServers
        : data.iceServers && typeof data.iceServers === "object" ? [data.iceServers] : [];
      if (!response.ok || !iceServers.length) throw new Error("TURN credential generation failed");
      return json({ iceServers: [...stun, ...iceServers], turn: true, expiresAt: Date.now() + TURN_TTL_SECONDS * 1000 });
    } catch {
      return json({ iceServers: stun, turn: false });
    } finally {
      clearTimeout(timer);
    }
  }

  if (url.pathname === "/api/rooms" && request.method === "POST") {
    const limited = await rateLimit(request, env, "create");
    if (!limited.ok) return limited;
>>>>>>> 2e67a06 (最適化)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateCode();
      if (env?.ROOMS) {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
<<<<<<< HEAD
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
=======
        const init = await stub.fetch(new Request(url.origin + `/api/rooms/${code}`, {
          method: "POST",
          headers: {
            "x-room-init": "1",
            "x-room-code": code,
          },
        }));
        if (init.status === 409) continue;
        if (!init.ok) return init;
>>>>>>> 2e67a06 (最適化)
        return json({ code });
      }
      if (!getMemoryRoom(code)) {
        const room = getMemoryRoom(code, true);
<<<<<<< HEAD
        room.present.receiver = true;
=======
>>>>>>> 2e67a06 (最適化)
        return json({ code });
      }
    }
    return json({ error: "部屋を作れませんでした" }, 500);
  }

<<<<<<< HEAD
  const match = url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(join|signal|poll))?$/);
  if (!match) return json({ error: "not found" }, 404);
  const code = match[1].toUpperCase();

  if (env?.ROOMS) {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(request);
  }
  return handleRoom(getMemoryRoom(code), request, url, code);
=======
  const match = url.pathname.match(new RegExp(`^/api/rooms/(\\d{${CODE_LENGTH}})(?:/(join|signal|poll))?$`));
  if (!match) return json({ error: "not found" }, 404);
  const code = match[1].toUpperCase();

  let response;
  if (env?.ROOMS) {
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    response = await stub.fetch(request);
  } else {
    const room = getMemoryRoom(code);
    response = await handleRoom(room, request, url, code);
    const body = response.ok ? await response.clone().json().catch(() => ({})) : {};
    if ((response.status === 404 && roomExpired(room)) || body.deleted) memoryRooms.delete(code);
  }
  if (match[2] === "join" && request.method === "POST" && !response.ok) {
    const limited = await rateLimit(request, env, "join-failure");
    if (!limited.ok) return limited;
  }
  return response;
>>>>>>> 2e67a06 (最適化)
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
