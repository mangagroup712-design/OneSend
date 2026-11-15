import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

let serial = 0;
async function api(path, init = {}, network = `test-${serial++}`) {
  const headers = new Headers(init.headers);
  headers.set("x-onesend-network", network);
  const response = await worker.fetch(new Request(`http://local${path}`, { ...init, headers }), {});
  return { response, body: await response.json() };
}

test("部屋は6桁、役割トークンを必要とし、二重参加を拒否する", async () => {
  const network = `room-${serial++}`;
  const made = await api("/api/rooms", { method: "POST" }, network);
  assert.match(made.body.code, /^\d{6}$/);
  const joined = await api(`/api/rooms/${made.body.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "receiver" }) }, network);
  assert.equal(joined.response.status, 200);
  assert.match(joined.body.token, /^[a-f0-9]{64}$/);
  const duplicate = await api(`/api/rooms/${made.body.code}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "receiver" }) }, network);
  assert.equal(duplicate.response.status, 409);
  const anonymous = await api(`/api/rooms/${made.body.code}/poll?role=receiver`, {}, network);
  assert.equal(anonymous.response.status, 401);
  const unauthenticatedSignal = await api(`/api/rooms/${made.body.code}/signal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "receiver", payload: { kind: "ice" } }),
  }, network);
  assert.equal(unauthenticatedSignal.response.status, 401);
});

test("双方の参加者間でSDPとICEシグナルを中継できる", async () => {
  const network = `signal-${serial++}`;
  const made = await api("/api/rooms", { method: "POST" }, network);
  const sender = await api(`/api/rooms/${made.body.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "sender" }),
  }, network);
  const receiver = await api(`/api/rooms/${made.body.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "receiver" }),
  }, network);
  const signalHeaders = (token) => ({
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  });
  const offer = await api(`/api/rooms/${made.body.code}/signal`, {
    method: "POST",
    headers: signalHeaders(sender.body.token),
    body: JSON.stringify({ from: "sender", payload: { kind: "sdp-offer", sdp: "offer" } }),
  }, network);
  assert.equal(offer.response.status, 200);
  const receiverPoll = await api(`/api/rooms/${made.body.code}/poll?role=receiver&after=0`, {
    headers: { authorization: `Bearer ${receiver.body.token}` },
  }, network);
  assert.equal(receiverPoll.response.status, 200);
  assert.equal(receiverPoll.body.messages.at(-1).payload.kind, "sdp-offer");

  const answer = await api(`/api/rooms/${made.body.code}/signal`, {
    method: "POST",
    headers: signalHeaders(receiver.body.token),
    body: JSON.stringify({ from: "receiver", payload: { kind: "sdp-answer", sdp: "answer" } }),
  }, network);
  assert.equal(answer.response.status, 200);
  const senderPoll = await api(`/api/rooms/${made.body.code}/poll?role=sender&after=0`, {
    headers: { authorization: `Bearer ${sender.body.token}` },
  }, network);
  assert.equal(senderPoll.body.messages.at(-1).payload.kind, "sdp-answer");
});

test("端末一覧はネットワークごとに分離される", async () => {
  const device = { id: "device-test-123", profileId: "a".repeat(32), secret: "b".repeat(32), code: "123456", name: "端末" };
  assert.equal((await api("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(device) }, "net-a")).response.status, 200);
  assert.equal((await api("/api/devices", {}, "net-b")).body.devices.length, 0);
  assert.equal((await api("/api/devices", {}, "net-a")).body.devices.length, 1);
});

test("接続要求は承認・拒否・取消を認証付きで遷移する", async () => {
  const network = `request-${serial++}`;
  const secret = "c".repeat(32);
  const device = { id: "device-request-123", profileId: "d".repeat(32), secret, code: "123456", name: "端末" };
  await api("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(device) }, network);
  const requesterSecret = "e".repeat(32);
  const created = await api(`/api/devices/${device.id}/requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requesterSecret, senderName: "送信端末" }) }, network);
  const anonymousStatus = await api(`/api/devices/${device.id}/requests/${created.body.requestId}`, {}, network);
  assert.equal(anonymousStatus.response.status, 403);
  const senderStatus = await api(`/api/devices/${device.id}/requests/${created.body.requestId}`, { headers: { authorization: `Bearer ${requesterSecret}` } }, network);
  assert.equal(senderStatus.response.status, 200);
  const accepted = await api(`/api/devices/${device.id}/requests/${created.body.requestId}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ accepted: true }) }, network);
  assert.equal(accepted.response.status, 200);
  assert.equal((await api(`/api/devices/${device.id}/requests/${created.body.requestId}`, { headers: { authorization: `Bearer ${secret}` } }, network)).body.status, "accepted");
});

test("長すぎる入力と巨大なシグナルを拒否する", async () => {
  const network = `invalid-${serial++}`;
  const made = await api("/api/rooms", { method: "POST" }, network);
  const longName = await api(`/api/rooms/${made.body.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "sender", name: "あ".repeat(33) }),
  }, network);
  assert.equal(longName.response.status, 400);

  const joined = await api(`/api/rooms/${made.body.code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "sender" }),
  }, network);
  const huge = await api(`/api/rooms/${made.body.code}/signal`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${joined.body.token}` },
    body: JSON.stringify({ from: "sender", payload: { value: "x".repeat(33 * 1024) } }),
  }, network);
  assert.equal(huge.response.status, 413);
});

test("期限切れの部屋はメモリ実装でも利用できない", async () => {
  const network = `expiry-${serial++}`;
  const made = await api("/api/rooms", { method: "POST" }, network);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 15 * 60 * 1000 + 1;
    const joined = await api(`/api/rooms/${made.body.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "receiver" }),
    }, network);
    assert.equal(joined.response.status, 404);
  } finally {
    Date.now = originalNow;
  }
});
