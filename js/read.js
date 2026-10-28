import {
  createRoom,
  decideRequest,
  joinRoom,
  listRequests,
  openSignal,
  publishDevice,
  removeDevice,
} from "./signal.js";
import { authorizeReceiver, connectTransfer, formatSize, formatSpeed, receiveFiles } from "./peer.js";

const currentFile = document.getElementById("current-file");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const speedLabel = document.getElementById("speed-label");
const result = document.getElementById("result");
const previewContent = document.getElementById("preview-content");
const zipDownloadButton = document.getElementById("zip-download-btn");
const againButton = document.getElementById("again-btn");
const banner = document.getElementById("banner");
const pairing = document.getElementById("pairing");
const deviceNameInput = document.getElementById("device-name");
const pinRequiredInput = document.getElementById("pin-required");
const pinField = document.getElementById("pin-field");
const receivePinInput = document.getElementById("receive-pin");
const requestList = document.getElementById("request-list");
const approvalDialog = document.getElementById("approval-dialog");
const approvalDetails = document.getElementById("approval-details");
const approvalTitle = document.getElementById("approval-title");
const acceptApproval = document.getElementById("accept-approval");
const rejectApproval = document.getElementById("reject-approval");
const webrtcMode = document.getElementById("webrtc-mode");
const webrtcPanel = document.getElementById("webrtc-panel");
const webrtcRoomInput = document.getElementById("webrtc-room-code");
const openWebrtcReceive = document.getElementById("open-webrtc-receive");
const showWebrtcQr = document.getElementById("show-webrtc-qr");
const qrDialog = document.getElementById("qr-dialog");
const qrCanvas = document.getElementById("qr-canvas");
const qrUrl = document.getElementById("qr-url");
let shownRequest = null;
const storageNameKey = "OneSend-device-name";
const profileIdKey = "OneSend-profile-id";
const deviceId = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function randomHex() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2).padEnd(48, "0")}`;
}

const profileId = localStorage.getItem(profileIdKey) || (() => {
  const id = randomHex();
  localStorage.setItem(profileIdKey, id);
  return id;
})();
const deviceSecret = randomHex();

let receivedUrls = [];
const receivedFiles = [];
let active = null;
let lastRequestSignature = "";

function suggestedDeviceName() {
  const first = ["青い", "白い", "水色の", "紺色の", "銀色の", "静かな", "速い", "小さな"];
  const second = ["きつね", "つばめ", "くじら", "こあら", "ふくろう", "いるか", "うさぎ", "たぬき"];
  const pick = (list) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
  return `${pick(first)} ${pick(second)}`;
}

deviceNameInput.value = localStorage.getItem(storageNameKey) || suggestedDeviceName();
localStorage.setItem(storageNameKey, deviceNameInput.value);
pinRequiredInput.checked = localStorage.getItem("OneSend-pin-required") === "true";
receivePinInput.value = localStorage.getItem("OneSend-pin") || "";
pinField.classList.toggle("hidden", !pinRequiredInput.checked);
receivePinInput.required = pinRequiredInput.checked;

function saveSettings() {
  deviceNameInput.value = deviceNameInput.value.trim().slice(0, 32) || "この端末";
  receivePinInput.value = receivePinInput.value.trim().slice(0, 32);
  localStorage.setItem(storageNameKey, deviceNameInput.value);
  localStorage.setItem("OneSend-pin-required", String(pinRequiredInput.checked));
  localStorage.setItem("OneSend-pin", receivePinInput.value.slice(0, 32));
  pinField.classList.toggle("hidden", !pinRequiredInput.checked);
  receivePinInput.required = pinRequiredInput.checked;
  if (active?.code) publishDeviceInfo(active.code).catch((error) => showBanner(error.message));
  if (pinRequiredInput.checked && !receivePinInput.value) showBanner("PINを入力すると、PIN必須設定が有効になります。", "warn");
}

deviceNameInput.addEventListener("change", saveSettings);
pinRequiredInput.addEventListener("change", saveSettings);
receivePinInput.addEventListener("change", saveSettings);

const showBanner = (message, type = "error") => {
  banner.textContent = message;
  banner.className = `banner ${type}`;
  banner.classList.remove("hidden");
};

function splitFileName(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0
    ? { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toLowerCase() }
    : { base: fileName, extension: "" };
}

function safeFileName(value, fallback) {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  return cleaned || fallback;
}

function updateProgress(progress) {
  const percent = progress?.percent || 0;
  progressBar.style.width = `${percent}%`;
  if (!progress?.totalBytes) {
    progressLabel.textContent = percent === 100 ? "100%（0 B / 0 B）" : "0%";
    speedLabel.textContent = percent === 100 ? "受信速度: 完了" : "受信速度: 待機中";
    return;
  }
  const fileNote = progress.fileName ? ` / ${progress.fileName}` : "";
  progressLabel.textContent = `${percent}%（${formatSize(progress.receivedBytes)} / ${formatSize(progress.totalBytes)}${fileNote}）`;
  speedLabel.textContent = `受信速度: ${formatSpeed(progress.speed)}`;
}

function appendPreview(blob, meta) {
  const url = URL.createObjectURL(blob);
  receivedUrls.push(url);
  const file = {
    blob,
    name: meta.name,
    mime: meta.mime,
    size: meta.size || blob.size,
    url,
    cleanup: meta.cleanup,
  };
  receivedFiles.push(file);
  const item = document.createElement("article");
  item.className = "received-item";
  const nameEditor = document.createElement("label");
  nameEditor.className = "file-name-editor";
  const parts = splitFileName(file.name);
  let downloadLink = null;
  const input = document.createElement("input");
  input.className = "file-item-name";
  input.type = "text";
  input.value = parts.base;
  input.setAttribute("aria-label", `${file.name}の拡張子を除いた保存名`);
  const extension = document.createElement("span");
  extension.className = "file-name-extension";
  extension.textContent = parts.extension ? `.${parts.extension}` : "";
  const updateName = () => {
    file.name = `${safeFileName(input.value, parts.base)}${parts.extension ? `.${parts.extension}` : ""}`;
    input.value = splitFileName(file.name).base;
    if (downloadLink) downloadLink.download = file.name;
  };
  input.addEventListener("change", updateName);
  input.addEventListener("blur", updateName);
  nameEditor.append(input, extension);
  const metaLine = document.createElement("p");
  metaLine.className = "file-item-meta";
  metaLine.textContent = formatSize(file.size);
  item.append(nameEditor, metaLine);
  if (file.mime.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = file.name;
    item.append(image);
  } else if (file.mime.startsWith("video/")) {
    const player = document.createElement("video");
    player.src = url;
    player.controls = true;
    player.playsInline = true;
    item.append(player);
  } else if (file.mime.startsWith("audio/")) {
    const player = document.createElement("audio");
    player.src = url;
    player.controls = true;
    item.append(player);
  } else if (file.mime === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = file.name;
    frame.height = 320;
    item.append(frame);
  } else {
    const note = document.createElement("p");
    note.textContent = "プレビュー非対応の形式です。ダウンロードして確認してください。";
    item.append(note);
  }
  downloadLink = document.createElement("a");
  downloadLink.className = "secondary-link";
  downloadLink.href = url;
  downloadLink.download = file.name;
  downloadLink.textContent = "ファイルをダウンロード";
  item.append(downloadLink);
  previewContent.append(item);
  result.classList.remove("hidden");
  againButton.disabled = true;
  zipDownloadButton.classList.toggle("hidden", receivedFiles.length < 1);
}

async function downloadZip() {
  if (!window.JSZip || !receivedFiles.length) {
    showBanner("ZIP機能の読み込みが完了していません。オンラインで一度開いてから再試行してください。");
    return;
  }
  zipDownloadButton.disabled = true;
  try {
    const zip = new JSZip();
    const usedNames = new Set();
    receivedFiles.forEach((file) => {
      const original = file.name;
      const parts = splitFileName(original);
      let candidate = original;
      let number = 2;
      while (usedNames.has(candidate)) {
        candidate = `${parts.base} (${number})${parts.extension ? `.${parts.extension}` : ""}`;
        number += 1;
      }
      usedNames.add(candidate);
      zip.file(candidate, file.blob);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "OneSend-received-files.zip";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showBanner(`ZIPの作成に失敗しました: ${error.message}`);
  } finally {
    zipDownloadButton.disabled = false;
  }
}

function resetResults() {
  previewContent.replaceChildren();
  receivedUrls.forEach((url) => URL.revokeObjectURL(url));
  receivedFiles.forEach((file) => file.cleanup?.());
  receivedUrls = [];
  receivedFiles.length = 0;
  zipDownloadButton.classList.add("hidden");
  result.classList.add("hidden");
  againButton.disabled = false;
  updateProgress();
}

async function stopSession() {
  if (!active) return;
  const session = active;
  active = null;
  session.stopping = true;
  clearInterval(session.heartbeat);
  clearInterval(session.poller);
  await removeDevice(session.id, deviceSecret).catch(() => {});
  await session.stop();
}

function publishDeviceInfo(code, available = active?.available ?? true) {
  return publishDevice({
    id: deviceId,
    profileId,
    secret: deviceSecret,
    name: deviceNameInput.value.trim() || "この端末",
    code,
    pinRequired: pinRequiredInput.checked && Boolean(receivePinInput.value.trim()),
    available,
  });
}

function renderRequests(requests) {
  const signature = JSON.stringify(requests.map(({ id, senderName, files, totalBytes, status }) => [id, senderName, files, totalBytes, status]));
  if (signature === lastRequestSignature) return;
  lastRequestSignature = signature;
  requestList.replaceChildren();
  approvalDetails.replaceChildren();
  const request = requests.find((entry) => entry.status === "pending");
  if (!request) {
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = requests.some((entry) => entry.status === "expired") ? "接続要求は30秒でタイムアウトしました。送信側に通知されました。" : "接続要求を待っています…";
    requestList.append(message);
    shownRequest = null;
    if (approvalDialog.open) approvalDialog.close();
    return;
  }
  shownRequest = request;
  const rows = Array.isArray(request.files) ? request.files : [];
  approvalTitle.textContent = request.contentType === "text" ? "このテキストを受け取りますか？" : request.contentType === "mixed" ? "このファイルとテキストを受け取りますか？" : "このファイルを受け取りますか？";
  const title = document.createElement("p"); title.className = "request-name";
  title.textContent = `${request.senderName} から${request.contentType === "text" ? "テキスト共有" : request.contentType === "mixed" ? "ファイルとテキスト共有" : "ファイル送信"}のリクエスト`;
  const summary = document.createElement("p"); summary.textContent = request.contentType === "text" ? `テキスト ${request.textLength} 文字` : `${request.fileCount ?? rows.length} ファイル・合計 ${formatSize(request.totalBytes || 0)}${request.contentType === "mixed" ? `・テキスト ${request.textLength} 文字` : ""}`;
  const list = document.createElement("ul"); list.className = "approval-file-list";
  rows.forEach((file) => { const li = document.createElement("li"); li.textContent = `${file.name} — ${formatSize(file.size)}`; list.append(li); });
  if ((request.fileCount || rows.length) > rows.length) { const li = document.createElement("li"); li.textContent = `ほか ${request.fileCount - rows.length} 件`; list.append(li); }
  approvalDetails.append(title, summary, list);
  if (!approvalDialog.open) approvalDialog.showModal();
}

async function refreshRequests() {
  if (!active?.available || active.accepting) return;
  try {
    const { requests } = await listRequests(active.id, deviceSecret);
    if (active?.available && !active.accepting) renderRequests(requests);
  } catch (error) {
    if (active?.available) showBanner(error.message || "接続要求を取得できませんでした。");
  }
}

async function answerRequest(request, accepted) {
  if (!active?.available || active.accepting) return;
  const session = active;
  try {
    await decideRequest(active.id, request.id, accepted, deviceSecret);
    if (!accepted) {
      showBanner(`${request.senderName}からの接続要求を拒否しました。`, "warn");
      refreshRequests();
      return;
    }
    active.available = false;
    active.accepting = true;
    clearInterval(active.heartbeat);
    clearInterval(active.poller);
    await publishDeviceInfo(active.code, false);
    renderRequests([]);
    const { signal, code } = active;
    currentFile.textContent = `${request.senderName}と安全な接続を準備しています…`;
    showBanner(`${request.senderName}の接続を承認しました。`, "ok");
    const connected = await connectTransfer({
      isOfferer: false,
      sendSignal: (payload) => signal.send(payload),
      subscribe: (listener) => signal.subscribe(listener),
    });
    active.pc = connected.pc;
    active.channel = connected.channel;
    const pin = pinRequiredInput.checked ? receivePinInput.value : "";
    await authorizeReceiver(active.channel, pin);
    pairing.classList.add("hidden");
    currentFile.textContent = "接続しました。ファイルを待っています";
    showBanner("接続しました。ファイルを受信しています。", "ok");

    receiveFiles(active.channel, {
      onBatch(files, totalBytes) {
        currentFile.textContent = `${files.length}個のファイルを受信します（${formatSize(totalBytes)}）`;
      },
      onFileStart(file) {
        currentFile.textContent = `受信中: ${file.name}（${file.index + 1} / ${formatSize(file.size)}）`;
      },
      onProgress(progress) {
        if (progress.fileName) {
          currentFile.textContent = `受信中: ${progress.fileName}（${(progress.fileIndex || 0) + 1} / ${progress.fileCount || "?"}）`;
        }
        updateProgress(progress);
      },
      onFile(blob, meta) {
        appendPreview(blob, meta);
      },
      onText(text, createdAt, title) {
        appendTextHistory(text, createdAt, title);
        currentFile.textContent = "テキストを受信しました";
        showBanner("テキストを受信しました。", "ok");
        againButton.disabled = false;
        window.setTimeout(() => { if (active === session) startReceiver(); }, 500);
      },
      onComplete() {
        currentFile.textContent = "すべてのファイルを受信しました";
        showBanner("受信が完了しました。", "ok");
        againButton.disabled = false;
        if (active === session) removeDevice(session.id, deviceSecret).catch(() => {});
      },
      onError(error) {
        if (active !== session || session.stopping) return;
        const message = `${error.message} 受信を中断し、待機画面に戻ります。`;
        startReceiver().then(() => showBanner(message, "warn"));
      },
    });
  } catch (error) {
    await stopSession();
    currentFile.textContent = "接続できませんでした";
    showBanner(error.message || "接続を開始できませんでした。");
    window.setTimeout(() => {
      if (!active) startReceiver();
    }, 1500);
  }
}

function appendTextHistory(text, createdAt, title = "テキスト") {
  document.getElementById("text-history").classList.remove("hidden");
  const historyList = document.getElementById("text-history-list");
  const item = document.createElement("article"); item.className = "received-item text-history-item";
  const heading = document.createElement("h3"); heading.textContent = title || "テキスト";
  const body = document.createElement("p"); body.textContent = text;
  const time = document.createElement("small"); time.textContent = new Date(createdAt).toLocaleString();
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary"; copy.textContent = "コピー";
  copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); showBanner("テキストをコピーしました。", "ok"); } catch { showBanner("クリップボードにコピーできませんでした。"); } });
  item.append(heading, body, time, copy);
  try { const url = new URL(text.trim()); if (["http:", "https:"].includes(url.protocol)) { const open = document.createElement("a"); open.className = "secondary-link"; open.href = url.href; open.target = "_blank"; open.rel = "noopener noreferrer"; open.textContent = "開く"; item.append(open); } } catch {}
  historyList.prepend(item);
}
acceptApproval.addEventListener("click", () => { if (shownRequest) answerRequest(shownRequest, true); });
rejectApproval.addEventListener("click", () => { if (shownRequest) answerRequest(shownRequest, false); });
webrtcRoomInput?.addEventListener("input", () => {
  webrtcRoomInput.value = webrtcRoomInput.value.replace(/\D/g, "").slice(0, 6);
  webrtcRoomInput.setCustomValidity("");
  showWebrtcQr.disabled = !/^\d{6}$/.test(webrtcRoomInput.value);
});
webrtcMode?.addEventListener("change", async () => {
  webrtcPanel.classList.toggle("hidden", !webrtcMode.checked);
  if (!webrtcMode.checked) {
    webrtcRoomInput.value = "";
    if (active?.available) await stopSession();
  }
});
openWebrtcReceive?.addEventListener("click", (event) => {
  const code = webrtcRoomInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    webrtcRoomInput.setCustomValidity("6文字の部屋コードを入力してください。");
    webrtcRoomInput.reportValidity();
    return;
  }
  startWebrtcReceiver(code);
});
showWebrtcQr?.addEventListener("click", () => {
  const url = new URL(`/receive.html?webrtc=1&code=${encodeURIComponent(webrtcRoomInput.value)}`, window.location.origin).href;
  if (!globalThis.QRCode?.toCanvas) {
    showBanner("QRコード機能を読み込めませんでした。");
    return;
  }
  globalThis.QRCode.toCanvas(qrCanvas, url, { width: 240, margin: 2 }, (error) => {
    if (error) {
      showBanner("QRコードを作成できませんでした。");
      return;
    }
    qrUrl.textContent = url;
    qrDialog.showModal();
  });
});

async function startWebrtcReceiver(code) {
  if (active) await stopSession();
  resetResults();
  pairing.classList.add("hidden");
  currentFile.textContent = "WebRTC接続を待っています…";
  const signal = openSignal(code, "receiver");
  const session = {
    id: deviceId,
    code,
    signal,
    available: false,
    accepting: true,
    pc: null,
    channel: null,
    heartbeat: null,
    poller: null,
    stopping: false,
  };
  session.stop = async () => {
    session.channel?.close();
    session.pc?.close();
    await signal.close();
  };
  active = session;
  try {
    await joinRoom(code, "receiver");
    const connected = await connectTransfer({
      isOfferer: false,
      sendSignal: (payload) => signal.send(payload),
      subscribe: (listener) => signal.subscribe(listener),
    });
    session.pc = connected.pc;
    session.channel = connected.channel;
    await authorizeReceiver(session.channel, code);
    currentFile.textContent = "接続しました。ファイルを待っています";
    showBanner("WebRTC接続が完了しました。", "ok");
    receiveFiles(session.channel, {
      onBatch(files, totalBytes) {
        currentFile.textContent = `${files.length}個のファイルを受信します（${formatSize(totalBytes)}）`;
      },
      onFileStart(file) {
        currentFile.textContent = `受信中: ${file.name}`;
      },
      onProgress(progress) {
        updateProgress(progress);
      },
      onFile(blob, meta) {
        appendPreview(blob, meta);
      },
      onText(text, createdAt, title) {
        appendTextHistory(text, createdAt, title);
        currentFile.textContent = "テキストを受信しました";
      },
      onComplete() {
        currentFile.textContent = "すべてのファイルを受信しました";
        showBanner("WebRTCで受信が完了しました。", "ok");
      },
      onError(error) {
        if (!session.stopping) showBanner(error.message || "WebRTC受信に失敗しました。");
      },
    });
  } catch (error) {
    await stopSession();
    showBanner(error.message || "WebRTC接続に失敗しました。");
    currentFile.textContent = "接続できませんでした";
  }
}

async function startReceiver() {
  await stopSession();
  resetResults();
  pairing.classList.remove("hidden");
  currentFile.textContent = "受信端末を準備しています…";
  lastRequestSignature = "";
  requestList.replaceChildren();

  try {
    const { code } = await createRoom();
    const signal = openSignal(code, "receiver");
    signal.subscribe((payload) => {
      if (payload?.kind === "signal-error") showBanner(payload.message);
    });
    await joinRoom(code, "receiver");
    const session = {
      id: deviceId,
      code,
      signal,
      available: true,
      accepting: false,
      pc: null,
      channel: null,
      heartbeat: null,
      poller: null,
    };
    session.stop = async () => {
      session.channel?.close();
      session.pc?.close();
      await signal.close();
    };
    active = session;
    await publishDeviceInfo(code);
    currentFile.textContent = "送信側からの接続要求を待っています";
    showBanner("受信端末を公開しました。送信側の接続要求を確認してください。", "ok");
    active.heartbeat = window.setInterval(() => {
      if (active?.available) publishDeviceInfo(code).catch((error) => showBanner(error.message));
    }, 15_000);
    active.poller = window.setInterval(refreshRequests, 1500);
    refreshRequests();
  } catch (error) {
    currentFile.textContent = "待機を開始できません";
    showBanner(error.message || "受信の準備に失敗しました。");
  }
}

zipDownloadButton.addEventListener("click", downloadZip);
againButton.addEventListener("click", startReceiver);
window.addEventListener("pagehide", () => stopSession());

const initialWebrtcCode = new URLSearchParams(location.search).get("code") || "";
if (initialWebrtcCode && /^\d{6}$/.test(initialWebrtcCode)) {
  webrtcMode.checked = true;
  webrtcPanel.classList.remove("hidden");
  webrtcRoomInput.value = initialWebrtcCode;
  showWebrtcQr.disabled = false;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => startWebrtcReceiver(initialWebrtcCode), { once: true });
  else startWebrtcReceiver(initialWebrtcCode);
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startReceiver, { once: true });
} else {
  startReceiver();
}
