import { createRoom, joinRoom, openSignal } from "./signal.js";
import {
  authorizeReceiver,
  authorizeSender,
  connectTransfer,
  formatSize,
  formatSpeed,
  receiveFiles,
  sendFiles,
} from "./peer.js";

const role = document.body.dataset.remoteRole;
const sender = role === "sender";
const fileInput = document.getElementById("file-input");
const fileCard = document.getElementById("file-card");
const fileList = document.getElementById("file-list");
const roomCode = document.getElementById("room-code");
const createRoomButton = document.getElementById("create-room");
const joinRoomButton = document.getElementById("join-room");
const startButton = document.getElementById("start-transfer");
const stopButton = document.getElementById("stop-transfer");
const roomStatus = document.getElementById("room-status");
const currentFile = document.getElementById("current-file");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const speedLabel = document.getElementById("speed-label");
const banner = document.getElementById("banner");
const receivedFiles = document.getElementById("received-files");

let files = [];
let signal = null;
let pc = null;
let channel = null;
let stopped = false;

function showBanner(message, type = "error") {
  banner.textContent = message;
  banner.className = `banner ${type}`;
  banner.classList.remove("hidden");
}

function updateProgress(progress) {
  progressBar.style.width = `${progress.percent || 0}%`;
  progressLabel.textContent = `${progress.percent || 0}%`;
  speedLabel.textContent = `${sender ? "送信" : "受信"}速度: ${formatSpeed(progress.speed)}`;
}

function renderFiles() {
  fileList.replaceChildren();
  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.textContent = `${file.name} (${formatSize(file.size)})`;
    fileList.append(item);
  });
  fileCard.classList.toggle("hidden", files.length === 0);
  if (startButton) startButton.disabled = files.length === 0 || !roomCode.value;
}

function setRoomCode(value) {
  roomCode.value = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (startButton) startButton.disabled = files.length === 0 || !/^[A-Z0-9]{6}$/.test(roomCode.value);
}

async function closeTransfer() {
  stopped = true;
  channel?.close();
  pc?.close();
  await signal?.close();
  channel = null;
  pc = null;
  signal = null;
  stopButton.disabled = true;
}

async function connect() {
  stopped = false;
  const code = roomCode.value;
  signal = openSignal(code, role);
  await joinRoom(code, role);
  const connected = await connectTransfer({
    isOfferer: sender,
    sendSignal: (payload) => signal.send(payload),
    subscribe: (listener) => signal.subscribe(listener),
  });
  pc = connected.pc;
  channel = connected.channel;
  stopButton.disabled = false;
  return connected;
}

async function send() {
  const snapshot = [...files];
  const code = roomCode.value;
  try {
    currentFile.textContent = "受信側の接続を待っています…";
    const connected = await connect();
    if (stopped) return;
    await authorizeSender(connected.channel, code);
    await sendFiles(connected.channel, snapshot, (progress) => {
      currentFile.textContent = progress.fileName ? `送信中: ${progress.fileName}` : "送信中";
      updateProgress(progress);
    }, connected.maxMessageSize);
    currentFile.textContent = "送信が完了しました";
    showBanner("送信が完了しました。", "ok");
  } catch (error) {
    if (!stopped) showBanner(error.message || "送信に失敗しました。");
  } finally {
    await closeTransfer();
  }
}

async function receive() {
  try {
    currentFile.textContent = "送信側の接続を待っています…";
    const connected = await connect();
    if (stopped) return;
    await authorizeReceiver(connected.channel, roomCode.value);
    receiveFiles(connected.channel, {
      onBatch(batch, totalBytes) {
        currentFile.textContent = `${batch.length}個のファイル（${formatSize(totalBytes)}）`;
      },
      onFileStart(file) {
        currentFile.textContent = `受信中: ${file.name}`;
      },
      onProgress: updateProgress,
      onFile(blob, meta) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = meta.name;
        link.textContent = `${meta.name} をダウンロード`;
        link.className = "secondary-link";
        receivedFiles.append(link);
        receivedFiles.classList.remove("hidden");
      },
      onComplete() {
        currentFile.textContent = "受信が完了しました";
        showBanner("受信が完了しました。", "ok");
      },
      onError(error) {
        if (!stopped) showBanner(error.message || "受信に失敗しました。");
      },
    });
  } catch (error) {
    if (!stopped) showBanner(error.message || "接続に失敗しました。");
  }
}

fileInput?.addEventListener("change", () => {
  files = [...fileInput.files];
  renderFiles();
});
roomCode.addEventListener("input", () => setRoomCode(roomCode.value));
createRoomButton?.addEventListener("click", async () => {
  try {
    createRoomButton.disabled = true;
    const result = await createRoom();
    setRoomCode(result.code);
    roomStatus.textContent = "このコードを受信側へ共有してください。";
    showBanner("部屋を作成しました。", "ok");
  } catch (error) {
    showBanner(error.message || "部屋を作成できませんでした。");
  } finally {
    createRoomButton.disabled = false;
  }
});
joinRoomButton?.addEventListener("click", () => {
  setRoomCode(roomCode.value);
  if (!/^[A-Z0-9]{6}$/.test(roomCode.value)) {
    showBanner("6文字の部屋IDを入力してください。");
    return;
  }
  joinRoomButton.disabled = true;
  receive();
});
startButton?.addEventListener("click", send);
stopButton.addEventListener("click", closeTransfer);
window.addEventListener("pagehide", closeTransfer);
const initialCode = new URLSearchParams(window.location.search).get("code");
if (initialCode) {
  setRoomCode(initialCode);
  if (!sender) {
    joinRoomButton.disabled = true;
    receive();
  }
}
