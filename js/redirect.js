import {
  decodeDestination,
  loadLinks,
  loadPending,
  mergeLinks,
} from "./lib.js";

const titleEl = document.getElementById("status-title");
const textEl = document.getElementById("status-text");
const homeLink = document.getElementById("home-link");

function notFound(message) {
  if (titleEl) titleEl.textContent = "リンクが見つかりません";
  if (textEl) textEl.textContent = message;
  if (homeLink) homeLink.classList.remove("hidden");
}

function pathToken() {
  const raw = location.pathname.replace(/^\/+|\/+$/g, "");
  if (!raw) return null;
  if (raw.includes("/")) return null;
  return raw;
}

function hashToken() {
  const raw = location.hash.replace(/^#+/, "");
  if (!raw) return null;
  return raw;
}

async function redirectTo(url) {
  if (titleEl) titleEl.textContent = "移動しています…";
  if (textEl) textEl.textContent = url;
  location.replace(url);
}

async function main() {
  const token = pathToken() || hashToken();

  if (!token) {
    // index.html also loads this module so hash links can work on static hosting.
    return;
  }

  try {
    // Legacy instant links: /~u… or /~z…
    if (token.startsWith("~") && token.length > 1) {
      const url = await decodeDestination(token.slice(1));
      if (!url) {
        notFound("この短縮リンクは壊れているか、形式が正しくありません。");
        return;
      }
      await redirectTo(url);
      return;
    }

    if (token.includes(".")) {
      location.replace("/");
      return;
    }

    const published = await loadLinks();
    const pending = loadPending();
    const links = mergeLinks(published, pending);
    const entry = links[token];

    if (entry?.url) {
      await redirectTo(entry.url);
      return;
    }

    // Instant packed links share the same path shape as vanity codes
    const url = await decodeDestination(token);
    if (url) {
      await redirectTo(url);
      return;
    }

    notFound(`「${token}」は登録されていないか、まだ公開前です。`);
  } catch {
    notFound("リンク情報の読み込みに失敗しました。");
  }
}

main();
