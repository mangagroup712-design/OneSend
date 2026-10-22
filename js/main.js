import {
  encodeDestination,
  instantShortUrl,
  isValidCode,
  loadLinks,
  loadPending,
  mergeLinks,
  normalizeUrl,
  redirectHtml,
  savePending,
  shortUrlFor,
} from "./lib.js";

const form = document.getElementById("shorten-form");
const urlInput = document.getElementById("url");
const customToggle = document.getElementById("custom-toggle");
const customField = document.getElementById("custom-field");
const customCodeInput = document.getElementById("custom-code");
const banner = document.getElementById("banner");
const result = document.getElementById("result");
const shortUrlEl = document.getElementById("short-url");
const resultMeta = document.getElementById("result-meta");
const copyBtn = document.getElementById("copy-btn");
const downloadBtn = document.getElementById("download-btn");
const publishHint = document.getElementById("publish-hint");
const submitBtn = document.getElementById("submit-btn");

let lastCreated = null;

function showBanner(message, type = "error") {
  banner.textContent = message;
  banner.className = `banner ${type}`;
  banner.classList.remove("hidden");
}

function hideBanner() {
  banner.classList.add("hidden");
}

function showResult(entry) {
  lastCreated = entry;
  shortUrlEl.href = entry.shortUrl;
  shortUrlEl.textContent = entry.shortUrl;
  resultMeta.textContent = `行き先: ${entry.url}`;

  const needsPublish = entry.mode === "vanity";
  if (downloadBtn) downloadBtn.classList.toggle("hidden", !needsPublish);
  if (publishHint) publishHint.classList.toggle("hidden", !needsPublish);
  result.classList.remove("hidden");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

customToggle.addEventListener("click", () => {
  const open = customField.classList.toggle("hidden");
  customToggle.textContent = open
    ? "カスタムコードを使う"
    : "カスタムコードを隠す";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideBanner();
  result.classList.add("hidden");

  const normalized = normalizeUrl(urlInput.value);
  if (!normalized) {
    showBanner("有効な URL を入力してください（例: https://example.com）");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "作成中…";

  try {
    const custom = customCodeInput.value.trim();
    const useCustom = !customField.classList.contains("hidden") && custom;

    if (useCustom) {
      if (!isValidCode(custom)) {
        showBanner(
          "カスタムコードは 1〜6 文字の英数字（大文字小文字を区別）のみです",
        );
        return;
      }

      const workerBase = window.OneCode_WORKER_BASE || location.origin;
      try {
        const response = await fetch(`${workerBase.replace(/\/$/, "")}/api/shorten`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: normalized, custom }),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(errorBody?.error || "Worker でのカスタム作成に失敗しました");
        }

        const data = await response.json();
        showResult({
          mode: "vanity",
          code: data.code,
          shortUrl: data.shortUrl,
          url: normalized,
          createdAt: new Date().toISOString(),
        });
        showBanner(
          "Cloudflare Worker にカスタム短縮リンクを保存しました。",
          "ok",
        );
      } catch {
        const published = await loadLinks();
        const pending = loadPending();
        const existing = mergeLinks(published, pending);

        if (existing[custom]) {
          showBanner("そのカスタムコードは既に使われています");
          return;
        }

        const entry = {
          url: normalized,
          createdAt: new Date().toISOString(),
        };
        pending[custom] = entry;
        savePending(pending);

        showResult({
          mode: "vanity",
          code: custom,
          shortUrl: shortUrlFor(custom),
          ...entry,
        });
        showBanner(
          "カスタムコードは作成済みです。本番反映にはファイルをダウンロードして Push してください。",
          "warn",
        );
      }
    } else {
      const workerBase = window.OneCode_WORKER_BASE || location.origin;
      try {
        const response = await fetch(`${workerBase.replace(/\/$/, "")}/api/shorten`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: normalized }),
        });

        if (!response.ok) {
          throw new Error("Worker での作成に失敗しました");
        }

        const data = await response.json();
        showResult({
          mode: "instant",
          code: data.code,
          shortUrl: data.shortUrl,
          url: normalized,
          createdAt: new Date().toISOString(),
        });
        showBanner(
          "Cloudflare Worker で短縮リンクを作成しました。どのデバイスからでも使えます。",
          "ok",
        );
      } catch {
        const payload = await encodeDestination(normalized);
        const shortUrl = instantShortUrl(payload);

        showResult({
          mode: "instant",
          code: payload,
          shortUrl,
          url: normalized,
          createdAt: new Date().toISOString(),
        });
        showBanner(
          "短縮リンクの準備ができました。どのデバイスからでもすぐに使えます。",
          "ok",
        );
      }
    }

    urlInput.value = "";
    customCodeInput.value = "";
  } catch (err) {
    showBanner(err.message || "作成に失敗しました");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "短縮する";
  }
});

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    if (!lastCreated) return;
    try {
      await navigator.clipboard.writeText(lastCreated.shortUrl);
      copyBtn.textContent = "コピー済み";
      setTimeout(() => {
        copyBtn.textContent = "コピー";
      }, 1600);
    } catch {
      showBanner("コピーに失敗しました。リンクを手動で選択してください。");
    }
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener("click", async () => {
    if (!lastCreated || lastCreated.mode !== "vanity") return;
    const published = await loadLinks();
    const pending = loadPending();
    const merged = mergeLinks(published, pending);

    downloadText("links.json", `${JSON.stringify(merged, null, 2)}\n`);
    downloadText(
      `${lastCreated.code}__index.html`,
      redirectHtml(lastCreated.url),
    );

    showBanner(
      `links.json でリポジトリの同名ファイルを上書きし、${lastCreated.code}__index.html を ${lastCreated.code}/index.html として配置して Push してください。`,
      "ok",
    );
  });
}

const params = new URLSearchParams(location.search);
if (params.get("missing") === "1") {
  showBanner("その短縮リンクは見つかりませんでした。", "warn");
  history.replaceState({}, "", "/");
}
