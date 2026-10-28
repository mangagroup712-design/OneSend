// Keep each SCTP message at the requested 64 KiB maximum. The send queue is
// bounded separately below so large files never have to be loaded in memory.
const CHUNK_SIZE = 64 * 1024;
// Keep a small, bounded amount queued. Browser implementations have different
// hard limits and can reject a send even when a large fixed threshold is used.
const SEND_QUEUE_LIMIT = 4 * 1024 * 1024;
const ACK_EVERY = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 25_000;

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

function parseMessage(data) {
  if (typeof data !== "string") return { binary: data };
  try {
    return { json: JSON.parse(data) };
  } catch {
    return {};
  }
}

function percent(value, total) {
  if (!total) return 0;
  return Math.min(100, Math.floor((value / total) * 100));
}

function speed(bytes, startedAt) {
  const elapsed = startedAt ? (performance.now() - startedAt) / 1000 : 0;
  return elapsed > 0 ? bytes / elapsed : 0;
}

export function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return "計測中";
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

export async function waitForChannel(channel) {
  if (channel.readyState === "open") return channel;
  if (channel.readyState === "closing" || channel.readyState === "closed") {
    throw new Error("データチャネルが閉じられました。");
  }
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("データチャネルを開けませんでした。"));
    };
    const cleanup = () => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("error", onError);
    };
    channel.addEventListener("open", onOpen);
    channel.addEventListener("error", onError);
  });
  return channel;
}

async function waitForSendCapacity(channel, bytes) {
  const deadline = Date.now() + 120_000;
  while (channel.readyState === "open" && channel.bufferedAmount + bytes > SEND_QUEUE_LIMIT) {
    if (Date.now() >= deadline) throw new Error("送信キューが解消しません。受信側の空き容量や接続状態を確認してください。");
    // Polling avoids relying on bufferedamountlow events, which vary between
    // browser engines and may be missed around threshold changes.
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  if (channel.readyState !== "open") throw new Error("転送中に接続が切れました。");
}

async function sendWithBackpressure(channel, data, byteLength) {
  const deadline = Date.now() + 120_000;
  while (true) {
    await waitForSendCapacity(channel, byteLength);
    try {
      channel.send(data);
      return;
    } catch (error) {
      const queueFull = error?.name === "OperationError" || /send queue is full|buffered amount|queue is full/i.test(error?.message || "");
      if (!queueFull) throw error;
      if (Date.now() >= deadline) throw new Error("送信キューが満杯のまま解消しません。受信側の接続を確認してください。");
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
}

export async function connectTransfer({ isOfferer, sendSignal, subscribe }) {
  const pc = createPeerConnection();
  const channelPromise = isOfferer
    ? Promise.resolve(pc.createDataChannel("OneSend", { ordered: true }))
    : new Promise((resolve) => {
      pc.ondatachannel = (event) => resolve(event.channel);
    });

  let applyingRemote = false;
  const pendingIce = [];
  const addIce = async (candidate) => {
    if (!candidate) return;
    if (!pc.remoteDescription) {
      pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // ignore stale candidates
    }
  };
  const flushIce = async () => {
    const queued = pendingIce.splice(0);
    for (const candidate of queued) await addIce(candidate);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) sendSignal({ kind: "ice", candidate: event.candidate.toJSON() });
  };

  subscribe(async (payload) => {
    if (!payload || payload.kind === "peer-joined" || payload.kind === "signal-error") return;
    if (payload.kind === "ice") {
      await addIce(payload.candidate);
      return;
    }
    if (payload.kind === "sdp-offer" && !isOfferer && !pc.currentRemoteDescription && !applyingRemote) {
      applyingRemote = true;
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal({ kind: "sdp-answer", sdp: answer.sdp });
      applyingRemote = false;
      return;
    }
    if (payload.kind === "sdp-answer" && isOfferer && !pc.currentRemoteDescription && !applyingRemote) {
      applyingRemote = true;
      await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      await flushIce();
      applyingRemote = false;
    }
  });

  if (isOfferer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendSignal({ kind: "sdp-offer", sdp: offer.sdp });
  }

  const channel = await Promise.race([
    channelPromise.then(waitForChannel),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("接続がタイムアウトしました。同じWi-Fiに接続し、受信側の画面を開いたままにしてください。"));
      }, CONNECT_TIMEOUT_MS);
    }),
  ]);
  channel.binaryType = "arraybuffer";
  const maxMessageSize = Number(pc.sctp?.maxMessageSize) > 0
    ? Number(pc.sctp.maxMessageSize)
    : 64 * 1024;
  return { pc, channel, maxMessageSize };
}

export async function authorizeSender(channel, pin = "") {
  await waitForChannel(channel);
  const result = waitForChannelMessage(channel, (message) => message?.type === "auth-result");
  channel.send(JSON.stringify({ type: "auth", pin: String(pin).trim() }));
  const response = await result;
  if (!response.accepted) throw new Error("PINが正しくありません。受信側の設定を確認してください。");
}

export async function authorizeReceiver(channel, expectedPin = "") {
  await waitForChannel(channel);
  const request = await waitForChannelMessage(channel, (message) => message?.type === "auth");
  const accepted = String(request.pin || "").trim() === String(expectedPin).trim();
  channel.send(JSON.stringify({ type: "auth-result", accepted }));
  if (!accepted) throw new Error("送信側のPINが一致しませんでした。");
}

function waitForChannelMessage(channel, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("認証がタイムアウトしました。")), 30_000);
    const onMessage = (event) => {
      const { json } = parseMessage(event.data);
      if (predicate(json)) finish(null, json);
    };
    const onClose = () => finish(new Error("認証中に接続が切れました。"));
    const finish = (error, value) => {
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      channel.removeEventListener("close", onClose);
      if (error) reject(error);
      else resolve(value);
    };
    channel.addEventListener("message", onMessage);
    channel.addEventListener("close", onClose);
  });
}

export async function sendFiles(channel, files, onProgress, maxMessageSize = 64 * 1024) {
  await waitForChannel(channel);
  channel.binaryType = "arraybuffer";
  const peerMessageLimit = Number(maxMessageSize) > 0 ? Number(maxMessageSize) : CHUNK_SIZE;
  const chunkSize = Math.max(1, Math.min(CHUNK_SIZE, peerMessageLimit));
  const fileMeta = files.map((file) => ({
    name: file.name.slice(0, 255),
    mime: (file.type || "application/octet-stream").slice(0, 128),
    size: file.size,
  }));
  const totalBytes = fileMeta.reduce((sum, file) => sum + file.size, 0);
  let ackedBytes = 0;
  let completed = false;
  let transferFailure = null;
  let rejectTransferFailure;
  const transferFailureWaiter = new Promise((_, reject) => { rejectTransferFailure = reject; });
  transferFailureWaiter.catch(() => {});
  const startedAt = performance.now();

  const report = (fileName) => {
    const visible = Math.min(totalBytes, ackedBytes);
    onProgress({
      sentBytes: visible,
      totalBytes,
      fileName,
      speed: speed(visible, startedAt),
      percent: totalBytes ? percent(visible, totalBytes) : completed ? 100 : 0,
    });
  };

  const onMessage = (event) => {
    const { json } = parseMessage(event.data);
    if (json?.type === "transfer-error") {
      transferFailure = new Error(String(json.message || "受信側で保存できませんでした。"));
      rejectTransferFailure(transferFailure);
      return;
    }
    if (json?.type === "bytes" && Number.isFinite(json.received)) {
      ackedBytes = Math.min(totalBytes, json.received);
      report(json.name || "");
    }
  };
  channel.addEventListener("message", onMessage);
  // Install the completion listener before sending. The receiver can finish
  // while the final buffered packets are draining, so registering afterward
  // can miss the one-shot completion message and leave the sender waiting.
  const completionWaiter = waitForComplete(channel, totalBytes);
  completionWaiter.promise.catch(() => {});

  try {
    channel.send(JSON.stringify({ type: "batch", files: fileMeta, totalBytes }));
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      if (transferFailure) throw transferFailure;
      channel.send(JSON.stringify({
        type: "file-start",
        index: fileIndex,
        name: fileMeta[fileIndex].name,
        mime: fileMeta[fileIndex].mime,
        size: file.size,
      }));
      for (let offset = 0; offset < file.size || file.size === 0; offset += chunkSize) {
        if (file.size === 0) break;
        if (transferFailure) throw transferFailure;
        if (channel.readyState !== "open") throw new Error("転送中に接続が切れました。");
        const slice = file.slice(offset, Math.min(file.size, offset + chunkSize));
        const buffer = await slice.arrayBuffer();
        await sendWithBackpressure(channel, buffer, buffer.byteLength);
        if (transferFailure) throw transferFailure;
        report(file.name);
      }
      channel.send(JSON.stringify({ type: "file-end", index: fileIndex }));
    }
    channel.send(JSON.stringify({ type: "batch-end" }));
    if (transferFailure) throw transferFailure;
    await Promise.race([completionWaiter.promise, transferFailureWaiter]);
    ackedBytes = totalBytes;
    completed = true;
    report("");
  } finally {
    completionWaiter.cancel();
    channel.removeEventListener("message", onMessage);
  }
}

export async function sendText(channel, text, title = "テキスト") {
  await waitForChannel(channel);
  const received = waitForChannelMessage(channel, (message) => message?.type === "shared-text-received");
  channel.send(JSON.stringify({ type: "shared-text", text: String(text).slice(0, 10000), title: String(title).slice(0, 80), createdAt: Date.now() }));
  await received;
}

function waitForComplete(channel, totalBytes) {
  let cancel;
  const promise = new Promise((resolve, reject) => {
    let timer;
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("受信確認がタイムアウトしました。接続状態を確認して再試行してください。"));
      }, 120_000);
    };
    armTimeout();
    const onMessage = (event) => {
      const { json } = parseMessage(event.data);
      if (json?.type === "bytes" && Number.isFinite(json.received)) armTimeout();
      if (json?.type === "complete" && json.received === totalBytes) {
        cleanup();
        resolve();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("転送中に接続が切れました。"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      channel.removeEventListener("close", onClose);
    };
    cancel = cleanup;
    channel.addEventListener("message", onMessage);
    channel.addEventListener("close", onClose);
  });
  return { promise, cancel: () => cancel?.() };
}

export function receiveFiles(channel, handlers) {
  channel.binaryType = "arraybuffer";
  let files = [];
  let totalBytes = 0;
  let receivedBytes = 0;
  let current = null;
  let lastAck = 0;
  let startedAt = 0;
  let completed = false;
  let messageQueue = Promise.resolve();
  let transferFailure = null;

  const emitProgress = (fileName) => {
    handlers.onProgress({
      receivedBytes,
      totalBytes,
      fileName,
      speed: speed(receivedBytes, startedAt),
      percent: totalBytes ? percent(receivedBytes, totalBytes) : completed ? 100 : 0,
      fileIndex: current?.index ?? 0,
      fileCount: files.length,
    });
  };

  const ack = (name, force = false) => {
    if (channel.readyState !== "open") return;
    if (!force && receivedBytes - lastAck < ACK_EVERY && receivedBytes !== totalBytes) return;
    lastAck = receivedBytes;
    channel.send(JSON.stringify({ type: "bytes", received: receivedBytes, name }));
  };

  const processMessage = async (event) => {
    if (transferFailure) return;
    const parsed = parseMessage(event.data);
    if (parsed.binary) {
      if (!current) return;
      if (current.writable) await current.writable.write(parsed.binary);
      else current.parts.push(parsed.binary);
      current.received += parsed.binary.byteLength;
      receivedBytes += parsed.binary.byteLength;
      if (!startedAt) startedAt = performance.now();
      emitProgress(current.name);
      ack(current.name);
      return;
    }
    const message = parsed.json;
    if (!message) return;
    if (message.type === "shared-text" && typeof message.text === "string") {
      completed = true;
      handlers.onText?.(message.text.slice(0, 10000), Number(message.createdAt) || Date.now(), String(message.title || "テキスト").slice(0, 80));
      if (channel.readyState === "open") channel.send(JSON.stringify({ type: "shared-text-received" }));
      return;
    }
    if (message.type === "batch") {
      files = Array.isArray(message.files) ? message.files : [];
      totalBytes = Number(message.totalBytes) || files.reduce((sum, file) => sum + (file.size || 0), 0);
      receivedBytes = 0;
      startedAt = 0;
      handlers.onBatch?.(files, totalBytes);
      emitProgress("");
      return;
    }
    if (message.type === "file-start") {
      current = {
        index: message.index,
        name: String(message.name || "received-file").slice(0, 255),
        mime: String(message.mime || "application/octet-stream").slice(0, 128),
        size: Number(message.size) || 0,
        received: 0,
        parts: [],
        writable: null,
        cleanup: null,
      };
      // OPFS lets large receives stream to local disk instead of retaining
      // the entire file (up to 2 GB) in JavaScript memory.
      let tempRoot = null;
      let tempName = "";
      try {
        const root = await navigator.storage?.getDirectory?.();
        if (root) {
          tempRoot = root;
          tempName = `onetransfer-${crypto.randomUUID()}.part`;
          const handle = await root.getFileHandle(tempName, { create: true });
          current.writable = await handle.createWritable();
          current.cleanup = () => root.removeEntry(tempName).catch(() => {});
          current.fileHandle = handle;
        }
      } catch {
        if (tempRoot && tempName) tempRoot.removeEntry(tempName).catch(() => {});
        current.writable = null;
        current.cleanup = null;
        current.fileHandle = null;
      }
      handlers.onFileStart?.(current);
      emitProgress(current.name);
      return;
    }
    if (message.type === "file-end" && current) {
      if (current.received !== current.size) {
        throw new Error(`${current.name} の受信サイズが一致しません。`);
      }
      let blob;
      if (current.writable && current.fileHandle) {
        await current.writable.close();
        blob = await current.fileHandle.getFile();
      } else {
        blob = new Blob(current.parts, { type: current.mime });
      }
      handlers.onFile?.(blob, current);
      ack(current.name, true);
      current = null;
      return;
    }
    if (message.type === "batch-end") {
      if (current || receivedBytes !== totalBytes) {
        throw new Error("受信したデータ量が送信側の情報と一致しません。");
      }
      completed = true;
      emitProgress("");
      if (channel.readyState === "open") {
        channel.send(JSON.stringify({ type: "complete", received: receivedBytes }));
      }
      handlers.onComplete?.();
    }
  };
  const onChannelClose = () => {
    if (completed || transferFailure) return;
    transferFailure = new Error("送信側で転送が停止されたか、接続が切れました。");
    Promise.resolve(current?.writable?.abort?.()).catch(() => {});
    current?.cleanup?.();
    handlers.onError?.(transferFailure);
  };
  channel.addEventListener("close", onChannelClose);
  channel.onmessage = (event) => {
    messageQueue = messageQueue.then(() => processMessage(event)).catch((error) => {
      if (transferFailure) return;
      transferFailure = error;
      try {
        if (channel.readyState === "open") channel.send(JSON.stringify({
          type: "transfer-error",
          message: error?.name === "QuotaExceededError"
            ? "受信端末の保存容量が足りません。空き容量を確保して再試行してください。"
            : `受信側でファイルを保存できませんでした: ${error?.message || "不明なエラー"}`,
        }));
      } catch { /* the sender will detect the closed channel */ }
      handlers.onError?.(error);
      Promise.resolve(current?.writable?.abort?.()).catch(() => {});
      current?.cleanup?.();
    });
  };
}
