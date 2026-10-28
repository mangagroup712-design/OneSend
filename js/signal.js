const ROLE = new Set(["sender", "receiver"]);

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `接続サーバーが応答しませんでした（${response.status}）`);
  }
  return data;
}

export async function createRoom() {
  return readJson(await fetch("/api/rooms", { method: "POST" }));
}

export async function joinRoom(code, role) {
  if (!ROLE.has(role)) throw new Error("役割が不正です");
  return readJson(await fetch(`/api/rooms/${encodeURIComponent(code)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  }));
}

async function directoryRequest(path, options = {}) {
  return readJson(await fetch(`/api/devices${path}`, {
    cache: "no-store",
    ...options,
  }));
}

export function listDevices(excludeProfileId = "") {
  const query = excludeProfileId ? `?excludeProfile=${encodeURIComponent(excludeProfileId)}` : "";
  return directoryRequest(query);
}

export function publishDevice(device) {
  return directoryRequest("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(device),
  });
}

export function removeDevice(deviceId, secret) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
    keepalive: true,
  });
}

export function requestDevice(deviceId, senderName, requesterSecret, metadata = {}) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderName, requesterSecret, ...metadata }),
  });
}

export function cancelRequest(deviceId, requestId, requesterSecret) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}/requests/${encodeURIComponent(requestId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cancel: true }),
  });
}

export function listRequests(deviceId, secret) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}/requests`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

export function decideRequest(deviceId, requestId, accepted, secret) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}/requests/${encodeURIComponent(requestId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ accepted }),
  });
}

export function getRequestStatus(deviceId, requestId) {
  return directoryRequest(`/${encodeURIComponent(deviceId)}/requests/${encodeURIComponent(requestId)}`);
}

export function openSignal(code, role) {
  let after = 0;
  let closed = false;
  const pending = [];
  const listeners = new Set();
  const history = [];

  const dispatch = (payload) => {
    history.push(payload);
    if (history.length > 40) history.shift();
    listeners.forEach((listener) => listener(payload));
  };

  const pump = async () => {
    while (!closed) {
      try {
        const response = await fetch(
          `/api/rooms/${encodeURIComponent(code)}/poll?role=${encodeURIComponent(role)}&after=${after}`,
          { cache: "no-store" },
        );
        const data = await readJson(response);
        after = data.next ?? after;
        for (const message of data.messages || []) {
          if (message.payload) dispatch(message.payload);
        }
      } catch (error) {
        if (closed) return;
        dispatch({ kind: "signal-error", message: error.message });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  };

  const loop = pump();

  return {
    subscribe(listener) {
      listeners.add(listener);
      history.forEach((payload) => listener(payload));
      return () => listeners.delete(listener);
    },
    async send(payload) {
      if (closed) return;
      const job = fetch(`/api/rooms/${encodeURIComponent(code)}/signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: role, payload }),
      }).then(readJson);
      pending.push(job);
      await job;
    },
    async close() {
      closed = true;
      await Promise.allSettled(pending);
      await Promise.race([loop, new Promise((resolve) => setTimeout(resolve, 50))]);
    },
  };
}
