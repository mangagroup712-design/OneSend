import { cancelRequest, createRoom, getRequestStatus, joinRoom, listDevices, openSignal, requestDevice } from "./signal.js";
import { authorizeSender, connectTransfer, formatSize, formatSpeed, sendFiles, sendText } from "./peer.js";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const fileCard = document.getElementById("file-card");
const fileList = document.getElementById("file-list");
const deviceNameInput = document.getElementById("device-name");
const deviceList = document.getElementById("device-list");
const stopButton = document.getElementById("stop-btn");
const panel = document.getElementById("transfer-panel");
const currentFile = document.getElementById("current-file");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const speedLabel = document.getElementById("speed-label");
const banner = document.getElementById("banner");
const pinDialog = document.getElementById("pin-dialog");
const pinForm = document.getElementById("pin-form");
const pinInput = document.getElementById("pin-input");
const sendFilesButton = document.getElementById("send-files-btn");
const clearSelectionButton = document.getElementById("clear-device-selection");
const textMessage = document.getElementById("text-message");
const addTextButton = document.getElementById("add-text-btn");
const openTextInputButton = document.getElementById("open-text-input");
const textInputPanel = document.getElementById("text-input-panel");
const pinCancelButton = document.getElementById("pin-cancel");
const webrtcMode = document.getElementById("webrtc-mode");
const webrtcRoomDialog = document.getElementById("webrtc-room-dialog");
const createWebrtcRoom = document.getElementById("create-webrtc-room");
const webrtcRoomCode = document.getElementById("webrtc-room-code");
const openWebrtcSend = document.getElementById("open-webrtc-send");

let selectedFiles = [];
let selectedText = "";
let selectedTextTitle = "";
let selectedDevices = [];
const deviceOutcomes = new Map();
let multiSelectMode = false;
let suppressDeviceClick = false;
let sendingBatch = false;
let cancelBatch = false;
let objectUrls = [];
let active = null;
let lastDeviceSignature = "";
const storageNameKey = "OneSend-device-name";
const profileIdKey = "OneSend-profile-id";

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

function suggestedDeviceName() {
  const first = ["青い", "白い", "水色の", "紺色の", "銀色の", "静かな", "速い", "小さな"];
  const second = ["きつね", "つばめ", "くじら", "こあら", "ふくろう", "いるか", "うさぎ", "たぬき"];
  const pick = (list) => list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
  return `${pick(first)} ${pick(second)}`;
}

function createRequestSecret() {
  return randomHex();
}

deviceNameInput.value = localStorage.getItem(storageNameKey) || suggestedDeviceName();
localStorage.setItem(storageNameKey, deviceNameInput.value);
deviceNameInput.addEventListener("change", () => {
  deviceNameInput.value = deviceNameInput.value.trim().slice(0, 32) || "この端末";
  localStorage.setItem(storageNameKey, deviceNameInput.value);
});

const showBanner = (message, type = "error") => {
  banner.textContent = message;
  banner.className = `banner ${type}`;
  banner.classList.remove("hidden");
};

function fileParts(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return { base: fileName, extension: "" };
  return { base: fileName.slice(0, dot), extension: fileName.slice(dot + 1).toUpperCase() };
}

function fileKind(file) {
  if (file.type.startsWith("image/")) return { className: "type-image", icon: "image", label: "" };
  if (file.type.startsWith("video/")) return { className: "type-video", icon: "movie", label: "動画" };
  if (file.type.startsWith("audio/")) return { className: "type-audio", icon: "music_note", label: "音声" };
  if (file.type === "application/pdf") return { className: "type-pdf", icon: "picture_as_pdf", label: "PDF" };
  if (file.type.includes("zip") || file.type.includes("compressed")) return { className: "type-archive", icon: "folder_zip", label: "" };
  return { className: "type-document", icon: "description", label: "" };
}

function updateFileName(index, value) {
  const current = selectedFiles[index];
  const { extension } = fileParts(current.name);
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!cleaned) return;
  const nextName = extension ? `${cleaned}.${extension.toLowerCase()}` : cleaned;
  selectedFiles[index] = new File([current], nextName, {
    type: current.type,
    lastModified: current.lastModified,
  });
}

function renderFileList() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
  fileList.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "file-item";
    const kind = fileKind(file);
    item.classList.add(kind.className);
    if (kind.className === "type-image") {
      const image = document.createElement("img");
      image.className = "file-thumb";
      image.alt = file.name;
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      image.src = url;
      item.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "file-thumb file-thumb-placeholder";
      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded file-type-icon";
      icon.textContent = kind.icon;
      const extension = document.createElement("span");
      extension.className = "file-extension";
      extension.textContent = fileParts(file.name).extension || kind.label || "FILE";
      placeholder.append(icon, extension);
      item.append(placeholder);
    }
    const info = document.createElement("div");
    info.className = "file-item-info";
    const { base } = fileParts(file.name);
    const nameEditor = document.createElement("label");
    nameEditor.className = "file-name-editor";
    const name = document.createElement("input");
    name.className = "file-item-name";
    name.type = "text";
    name.value = base;
    name.setAttribute("aria-label", `${file.name}の拡張子を除いたファイル名`);
    name.addEventListener("change", () => {
      updateFileName(index, name.value);
      renderFileList();
    });
    name.addEventListener("blur", () => {
      updateFileName(index, name.value);
      name.value = fileParts(selectedFiles[index].name).base;
    });
    const extension = document.createElement("span");
    extension.className = "file-name-extension";
    extension.textContent = fileParts(file.name).extension
      ? `.${fileParts(file.name).extension.toLowerCase()}`
      : "";
    nameEditor.append(name, extension);
    const meta = document.createElement("p");
    meta.className = "file-item-meta";
    meta.textContent = `${formatSize(file.size)} / ${file.type || "形式不明"}`;
    info.append(nameEditor, meta);
    item.append(info);
    const actions = document.createElement("div");
    actions.className = "file-item-actions";
    const remove = document.createElement("button");
    remove.className = "secondary";
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderFileList();
    });
    actions.append(remove);
    item.append(actions);
    fileList.append(item);
  });
  if (selectedText) {
    const item = document.createElement("div");
    item.className = "file-item text-file-item";
    const thumb = document.createElement("div"); thumb.className = "file-thumb file-thumb-placeholder text-thumb"; thumb.textContent = "T";
    const info = document.createElement("div"); info.className = "file-item-info";
    const name = document.createElement("input"); name.className = "text-file-title"; name.type = "text"; name.maxLength = 80; name.value = selectedTextTitle; name.setAttribute("aria-label", "共有テキストのタイトル");
    name.addEventListener("input", () => { selectedTextTitle = name.value; });
    const meta = document.createElement("p"); meta.className = "file-item-meta"; meta.textContent = `${selectedText.length.toLocaleString()} 文字`;
    info.append(name, meta);
    const actions = document.createElement("div"); actions.className = "file-item-actions";
    const remove = document.createElement("button"); remove.className = "secondary"; remove.type = "button"; remove.textContent = "削除";
    remove.addEventListener("click", () => { selectedText = ""; selectedTextTitle = ""; renderFileList(); });
    actions.append(remove); item.append(thumb, info, actions); fileList.append(item);
  }
  const hasContent = selectedFiles.length > 0 || Boolean(selectedText);
  fileCard.classList.toggle("hidden", !hasContent);
  if (sendFilesButton) sendFilesButton.disabled = selectedDevices.length === 0 || !hasContent;
}

function addFiles(files) {
  const invalid = files.find((file) => file.size > MAX_FILE_SIZE);
  if (invalid) {
    showBanner(`${invalid.name} は大きすぎます。1ファイル最大2GBです。`);
    return;
  }
  selectedFiles.push(...files);
  renderFileList();
  banner.classList.add("hidden");
}

function addText(value) {
  const text = String(value || "").trim();
  if (!text) return;
  selectedText = text.slice(0, 10000);
  selectedTextTitle = selectedText.split(/\r?\n/, 1)[0].trim().slice(0, 80) || "テキスト";
  textMessage.value = "";
  textInputPanel.classList.add("hidden");
  addTextButton.disabled = true;
  renderFileList();
  banner.classList.add("hidden");
}

async function importSharedPayload() {
  if (new URLSearchParams(location.search).get("share") !== "1") return;
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("OneSend-share", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("payload");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const payload = await new Promise((resolve, reject) => {
      const tx = db.transaction("payload", "readwrite"); const store = tx.objectStore("payload");
      const get = store.get("latest"); get.onsuccess = () => { const value = get.result; store.delete("latest"); resolve(value); }; get.onerror = () => reject(get.error);
    });
    if (!payload) return;
    addFiles((payload.files || []).map((file) => new File([file.blob], file.name, { type: file.type })));
    const sharedText = [payload.title, payload.text, payload.url].filter(Boolean).join("\n");
    if (sharedText) addText(sharedText);
    history.replaceState(null, "", location.pathname);
    showBanner("共有メニューから送信内容を取り込みました。相手を選んで送信してください。", "ok");
  } catch { showBanner("共有内容を読み込めませんでした。もう一度共有してください。"); }
}

fileInput.addEventListener("change", () => {
  addFiles([...fileInput.files]);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
}));
dropZone.addEventListener("drop", (event) => addFiles([...event.dataTransfer.files]));

function updateProgress(progress) {
  progressBar.style.width = `${progress.percent}%`;
  const fileNote = progress.fileName ? ` / ${progress.fileName}` : "";
  progressLabel.textContent = `${progress.percent}%（${formatSize(progress.sentBytes)} / ${formatSize(progress.totalBytes)}${fileNote}）`;
  speedLabel.textContent = `送信速度: ${formatSpeed(progress.speed)}`;
}

function updateSelectionUI() {
  const hasContent = selectedFiles.length > 0 || Boolean(selectedText);
  sendFilesButton.disabled = sendingBatch || selectedDevices.length === 0 || !hasContent;
  clearSelectionButton.disabled = sendingBatch;
  if (!selectedDevices.length) sendFilesButton.textContent = "送信";
  else if (selectedDevices.length === 1) sendFilesButton.textContent = `${selectedDevices[0].name}に送信`;
  else if (selectedDevices.length <= 3) sendFilesButton.textContent = `${selectedDevices.map((device) => device.name).join("、")}に送信`;
  else sendFilesButton.textContent = `選択した${selectedDevices.length}台に送信`;
  clearSelectionButton.classList.toggle("hidden", !multiSelectMode);
  document.querySelectorAll(".device-option").forEach((entry) => {
    const selected = selectedDevices.some((device) => device.id === entry.dataset.deviceId);
    const outcome = deviceOutcomes.get(entry.dataset.deviceId);
    const avatar = entry.querySelector(".device-avatar");
    const label = entry.querySelector(".device-label");
    entry.classList.toggle("multi-select", multiSelectMode);
    entry.classList.toggle("selected", selected);
    entry.classList.toggle("transfer-failed", outcome === "failed");
    entry.disabled = sendingBatch;
    entry.setAttribute("aria-pressed", String(selected));
    const mark = entry.querySelector(".device-check");
    if (mark) mark.textContent = selected ? "✓" : "";
    if (avatar) avatar.textContent = outcome === "failed" ? "!" : selected ? "✓" : avatar.dataset.initial;
    if (label) label.classList.toggle("device-label-failed", outcome === "failed");
  });
}

function toggleDeviceSelection(device) {
  const index = selectedDevices.findIndex((entry) => entry.id === device.id);
  const adding = index < 0;
  if (adding) selectedDevices.push(device);
  else selectedDevices.splice(index, 1);
  if (!selectedDevices.length) multiSelectMode = false;
  updateSelectionUI();
  if (adding) {
    const selectedButton = [...document.querySelectorAll(".device-option")].find((entry) => entry.dataset.deviceId === device.id);
    const avatar = selectedButton?.querySelector(".device-avatar");
    if (avatar) {
      avatar.classList.remove("device-selected-flip");
      void avatar.offsetWidth;
      avatar.classList.add("device-selected-flip");
    }
  }
}

function renderDevices(devices) {
  const signature = JSON.stringify(devices.map(({ id, name, pinRequired }) => [id, name, pinRequired]));
  if (signature === lastDeviceSignature) return;
  lastDeviceSignature = signature;
  deviceList.replaceChildren();
  if (!devices.length) {
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = "受信画面を開いている端末はまだありません。受信側でこのサービスを開いてください。";
    deviceList.append(message);
    selectedDevices = [];
    multiSelectMode = false;
    updateSelectionUI();
    return;
  }
  selectedDevices = selectedDevices.filter((selected) => devices.some((device) => device.id === selected.id)).map((selected) => devices.find((device) => device.id === selected.id));
  if (!selectedDevices.length) multiSelectMode = false;
  for (const [deviceIndex, device] of devices.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "device-option";
    if (multiSelectMode) button.classList.add("multi-select");
    button.dataset.deviceId = device.id;
    button.setAttribute("aria-label", `${device.name}${device.pinRequired ? "、PINが必要" : ""}を送信先に選択`);
    const avatar = document.createElement("span");
    avatar.className = "device-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.dataset.initial = [...device.name][0] || "端";
    avatar.textContent = deviceOutcomes.get(device.id) === "failed" ? "!" : selectedDevices.some((entry) => entry.id === device.id) ? "✓" : avatar.dataset.initial;
    button.style.setProperty("--device-index", deviceIndex);
    const name = document.createElement("span");
    name.className = "device-label";
    name.textContent = device.name;
    button.append(avatar, name);
    const check = document.createElement("span"); check.className = "device-check"; check.setAttribute("aria-hidden", "true"); check.textContent = selectedDevices.some((entry) => entry.id === device.id) ? "✓" : ""; button.append(check);
    if (selectedDevices.some((entry) => entry.id === device.id)) button.classList.add("selected");
    if (multiSelectMode) button.classList.add("multi-select");
    if (deviceOutcomes.get(device.id) === "failed") button.classList.add("transfer-failed");
    if (device.pinRequired) {
      const pin = document.createElement("span");
      pin.className = "pin-indicator";
      pin.textContent = "PIN設定中";
      button.append(pin);
    }
    let pressTimer = null;
    button.addEventListener("pointerdown", () => {
      suppressDeviceClick = false;
      pressTimer = window.setTimeout(() => {
        if (!multiSelectMode) {
          multiSelectMode = true;
          if (!selectedDevices.some((entry) => entry.id === device.id)) toggleDeviceSelection(device);
          else updateSelectionUI();
        } else toggleDeviceSelection(device);
        suppressDeviceClick = true;
        showBanner("複数選択モードです。送りたい端末をタップしてください。", "ok");
      }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => button.addEventListener(eventName, () => window.clearTimeout(pressTimer)));
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      if (suppressDeviceClick) { suppressDeviceClick = false; return; }
      if (multiSelectMode) toggleDeviceSelection(device);
      else {
        multiSelectMode = false;
        selectedDevices = [device];
        updateSelectionUI();
      }
      updateSelectionUI();
      showBanner(`${device.name}を選択しました。送信ボタンを押すと、受信側へ承認を求めます。`, "ok");
    });
    deviceList.append(button);
  }
  updateSelectionUI();
}

async function refreshDevices() {
  try {
    const { devices } = await listDevices(profileId);
    renderDevices(devices);
  } catch (error) {
    deviceList.replaceChildren();
    selectedDevices = [];
    multiSelectMode = false;
    updateSelectionUI();
    const message = document.createElement("p");
    message.className = "hint";
    message.textContent = `端末一覧を更新できません: ${error.message}`;
    deviceList.append(message);
  }
}

function promptForPin() {
  pinInput.value = "";
  return new Promise((resolve) => {
    const onCancel = () => pinDialog.close("cancel");
    const onSubmit = (event) => {
      event.preventDefault();
      pinDialog.close(event.submitter?.value || "continue");
    };
    const onClose = () => {
      pinForm.removeEventListener("submit", onSubmit);
      pinDialog.removeEventListener("close", onClose);
      pinCancelButton.removeEventListener("click", onCancel);
      resolve(pinDialog.returnValue === "continue" ? pinInput.value : null);
    };
    pinForm.addEventListener("submit", onSubmit);
    pinCancelButton.addEventListener("click", onCancel);
    pinDialog.addEventListener("close", onClose);
    pinDialog.showModal();
    pinInput.focus();
  });
}

async function requestTransfer(device, button) {
  if (active) return;
  if (!selectedFiles.length && !selectedText) return;
  const textSnapshot = selectedText;
  const textTitleSnapshot = selectedTextTitle;
  const filesSnapshot = [...selectedFiles];
  let pinCancelled = false;
  button.disabled = true;
  dropZone.classList.add("hidden");
  fileCard.classList.add("hidden");
  panel.classList.remove("hidden");
  currentFile.textContent = `${device.name} の承認を待っています…`;
  showBanner("受信側に接続リクエストを送りました。", "ok");
  updateProgress({ percent: 0, sentBytes: 0, totalBytes: filesSnapshot.reduce((sum, file) => sum + file.size, 0), fileName: "", speed: 0 });

  const session = { cancelled: false, requestId: null, requestSecret: createRequestSecret(), signal: null, pc: null, channel: null };
  active = {
    stop: async () => {
      session.cancelled = true;
      if (session.requestId) await cancelRequest(device.id, session.requestId, session.requestSecret).catch(() => {});
      session.channel?.close();
      session.pc?.close();
      await session.signal?.close();
    },
  };

  try {
    deviceOutcomes.delete(device.id);
    updateSelectionUI();
    const { requestId } = await requestDevice(device.id, deviceNameInput.value.trim() || "送信端末", session.requestSecret, {
      files: filesSnapshot.slice(0, 50).map((file) => ({ name: file.name, size: file.size })),
      fileCount: filesSnapshot.length,
      totalBytes: filesSnapshot.reduce((sum, file) => sum + file.size, 0),
      contentType: textSnapshot ? (filesSnapshot.length ? "mixed" : "text") : "files", textLength: textSnapshot.length,
    });
    session.requestId = requestId;
    if (session.cancelled) {
      await cancelRequest(device.id, requestId, session.requestSecret).catch(() => {});
      throw new Error("接続リクエストを取り消しました。");
    }
    const deadline = Date.now() + 30_000;
    let approval = null;
    while (Date.now() < deadline && !session.cancelled) {
      const status = await getRequestStatus(device.id, requestId);
      if (status.status === "accepted") {
        approval = status;
        break;
      }
      if (status.status === "rejected") throw new Error("受信側が接続を拒否しました。");
      if (status.status === "busy") throw new Error("受信側は別の転送に対応中です。");
      if (status.status === "canceled") throw new Error("接続リクエストは取り消されました。");
      if (status.status === "expired") throw new Error("受信側が30秒以内に応答しなかったため、リクエストはタイムアウトしました。");
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (session.cancelled) throw new Error("接続リクエストを取り消しました。");
    if (!approval) throw new Error("受信側が30秒以内に応答しませんでした。もう一度お試しください。");

    session.signal = openSignal(approval.code, "sender");
    session.signal.subscribe((payload) => {
      if (payload?.kind === "signal-error") showBanner(payload.message);
    });
    await joinRoom(approval.code, "sender");
    if (session.cancelled) throw new Error("転送を停止しました。");
    currentFile.textContent = "安全な端末間接続を準備しています…";
    const connected = await connectTransfer({
      isOfferer: true,
      sendSignal: (payload) => session.signal.send(payload),
      subscribe: (listener) => session.signal.subscribe(listener),
    });
    session.pc = connected.pc;
    session.channel = connected.channel;
    if (session.cancelled) throw new Error("転送を停止しました。");
    const pin = approval.pinRequired ? await promptForPin() : "";
    if (pin === null) {
      pinCancelled = true;
      panel.classList.add("hidden");
      throw new Error("PIN入力をキャンセルしました。受信側を待機画面に戻しています。");
    }
    currentFile.textContent = "PINを確認しています…";
    await authorizeSender(session.channel, pin);
    currentFile.textContent = "転送中";
    showBanner(textSnapshot ? (filesSnapshot.length ? "ファイルとテキストを送信しています。" : "テキストを送信しています。") : `${filesSnapshot.length}個のファイルを転送しています。`, "ok");
    if (filesSnapshot.length) await sendFiles(session.channel, filesSnapshot, (progress) => {
      currentFile.textContent = progress.fileName ? `送信中: ${progress.fileName}` : "転送中";
      updateProgress(progress);
    }, connected.maxMessageSize);
    if (textSnapshot) await sendText(session.channel, textSnapshot, textTitleSnapshot);
    currentFile.textContent = "送信が完了しました";
    showBanner("送信が完了しました。受信側で保存できます。", "ok");
  } catch (error) {
    showBanner(error.message || "転送に失敗しました。");
    currentFile.textContent = "接続できませんでした";
    if (!pinCancelled && /拒否|正しくありません|一致しません/.test(error.message || "")) {
      deviceOutcomes.set(device.id, "failed");
      updateSelectionUI();
    }
    if (pinCancelled) return false;
  } finally {
    button.disabled = sendingBatch;
    if (active) active = null;
    session.channel?.close();
    session.pc?.close();
    await session.signal?.close();
    dropZone.classList.remove("hidden");
    fileCard.classList.toggle("hidden", selectedFiles.length === 0 && !selectedText);
  }
  return true;
}

sendFilesButton.addEventListener("click", async () => {
  if (sendingBatch || !selectedDevices.length) return;
  sendingBatch = true;
  cancelBatch = false;
  updateSelectionUI();
  const targets = [...selectedDevices];
  sendFilesButton.disabled = true;
  try {
    for (const device of targets) {
      if (cancelBatch) break;
      const completed = await requestTransfer(device, sendFilesButton);
      if (completed === false || cancelBatch) break;
    }
  } finally {
    sendingBatch = false;
    updateSelectionUI();
  }
});
clearSelectionButton.addEventListener("click", () => {
  selectedDevices = [];
  multiSelectMode = false;
  updateSelectionUI();
});
openTextInputButton.addEventListener("click", () => {
  textInputPanel.classList.toggle("hidden");
  if (!textInputPanel.classList.contains("hidden")) textMessage.focus();
});
textMessage.addEventListener("input", () => { addTextButton.disabled = !textMessage.value.trim(); });
addTextButton.addEventListener("click", () => addText(textMessage.value));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !pinDialog.open && multiSelectMode) {
    multiSelectMode = false;
    selectedDevices = [];
    updateSelectionUI();
    document.querySelectorAll(".device-option").forEach((entry) => { entry.classList.remove("selected"); const mark = entry.querySelector(".device-check"); if (mark) mark.textContent = ""; });
  }
});
document.addEventListener("paste", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  const items = [...(event.clipboardData?.items || [])];
  const files = items.filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter(Boolean);
  if (files.length) {
    event.preventDefault();
    addFiles(files.map((file, index) => file.name ? file : new File([file], `clipboard-${Date.now()}-${index}.${file.type.split("/")[1] || "bin"}`, { type: file.type })));
    updateSelectionUI();
  } else {
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      event.preventDefault();
      textMessage.value = text.slice(0, 10000);
      addText(textMessage.value);
    }
  }
});

async function stopTransfer() {
  cancelBatch = true;
  if (active) {
    await active.stop();
    active = null;
  }
  panel.classList.add("hidden");
  dropZone.classList.remove("hidden");
  fileCard.classList.toggle("hidden", selectedFiles.length === 0 && !selectedText);
  showBanner("接続を停止しました。", "warn");
  refreshDevices();
}

stopButton.addEventListener("click", stopTransfer);
webrtcMode?.addEventListener("change", () => {
  if (!webrtcMode.checked) return;
  webrtcRoomCode.textContent = "";
  openWebrtcSend.disabled = true;
  webrtcRoomDialog.showModal();
});
createWebrtcRoom?.addEventListener("click", async () => {
  createWebrtcRoom.disabled = true;
  try {
    const { code } = await createRoom();
    webrtcRoomCode.textContent = code;
    openWebrtcSend.disabled = false;
  } catch (error) {
    showBanner(error.message || "部屋を作成できませんでした。");
  } finally {
    createWebrtcRoom.disabled = false;
  }
});
webrtcRoomDialog?.addEventListener("close", () => {
  if (webrtcRoomDialog.returnValue !== "continue") webrtcMode.checked = false;
});
openWebrtcSend?.addEventListener("click", (event) => {
  event.preventDefault();
  window.location.href = `/remote-send.html?code=${encodeURIComponent(webrtcRoomCode.textContent)}`;
});
window.addEventListener("pagehide", () => active?.stop());
refreshDevices();
importSharedPayload();
window.setInterval(refreshDevices, 4000);
