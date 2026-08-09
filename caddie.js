// Felix：對話介面（Layer 2，呼叫 Supabase Edge Function caddie-chat）
// 依賴 app.js 已定義的全域：supabaseClient、supabaseSession

const caddieStorageKey = "begin-with-end-caddie-chat";
const caddieModeKey = "begin-with-end-caddie-mode";

// 三個模式各有自己的 system prompt、工具與對話串，切換不會把脈絡帶過去
const CADDIE_MODES = [
  {
    id: "weekly",
    label: "週計畫",
    placeholder: "跟 Felix 排本週計畫、盤進度、決定先做哪件⋯（Enter 送出，Shift+Enter 換行）",
    empty: "Felix 開場會先看你的週計畫和 pipeline，給一份進度快照。",
    start: "開始本週對話",
  },
  {
    id: "accounts",
    label: "客戶戰情",
    placeholder: "談某位客戶、設計話術、拆反對問題⋯（Enter 送出，Shift+Enter 換行）",
    empty: "直接說要談誰、卡在哪。Felix 會先查這位客戶的資料再回。",
    start: null,
  },
  {
    id: "team",
    label: "團隊輔導",
    placeholder: "談帶人、輔導 member、單位目標⋯（Enter 送出，Shift+Enter 換行）",
    empty: "直接說要談哪位 member 或哪件事。",
    start: null,
  },
];

let caddieMode = CADDIE_MODES[0].id;
let caddieMessages = [];
let caddieSending = false;

function currentCaddieMode() {
  return CADDIE_MODES.find((mode) => mode.id === caddieMode) || CADDIE_MODES[0];
}

function caddieThreadKey(mode) {
  return `${caddieStorageKey}:${mode}`;
}

function loadCaddieMessages() {
  const stored = sessionStorage.getItem(caddieModeKey);
  if (CADDIE_MODES.some((mode) => mode.id === stored)) caddieMode = stored;
  try {
    caddieMessages = JSON.parse(sessionStorage.getItem(caddieThreadKey(caddieMode)) || "[]");
  } catch {
    caddieMessages = [];
  }
}

function persistCaddieMessages() {
  sessionStorage.setItem(caddieThreadKey(caddieMode), JSON.stringify(caddieMessages));
}

function switchCaddieMode(mode) {
  if (mode === caddieMode || caddieSending) return;
  caddieMode = mode;
  sessionStorage.setItem(caddieModeKey, mode);
  try {
    caddieMessages = JSON.parse(sessionStorage.getItem(caddieThreadKey(mode)) || "[]");
  } catch {
    caddieMessages = [];
  }
  const input = document.querySelector("#caddieInput");
  if (input) input.placeholder = currentCaddieMode().placeholder;
  renderCaddieModes();
  renderCaddie();
}

function renderCaddieModes() {
  document.querySelectorAll("[data-caddie-mode]").forEach((button) => {
    const active = button.dataset.caddieMode === caddieMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function caddieReady() {
  return Boolean(supabaseClient && supabaseSession?.user);
}

function escapeCaddieHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function caddieInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// 把 Felix 回覆的 Markdown 子集（粗體、行內代碼、標題、清單、表格）轉成 HTML；先跳脫原文防注入
function renderCaddieMarkdown(content) {
  const lines = escapeCaddieHtml(content).split("\n");
  const html = [];
  let listTag = null;
  let tableRows = null;

  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`);
      listTag = null;
    }
  };

  const closeTable = () => {
    if (!tableRows) return;
    const [head, ...body] = tableRows;
    const renderRow = (cells, tag) =>
      `<tr>${cells.map((cell) => `<${tag}>${caddieInline(cell)}</${tag}>`).join("")}</tr>`;
    html.push("<table>");
    html.push(`<thead>${renderRow(head, "th")}</thead>`);
    if (body.length) {
      html.push(`<tbody>${body.map((cells) => renderRow(cells, "td")).join("")}</tbody>`);
    }
    html.push("</table>");
    tableRows = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*•]\s+(.*)/);
    const ordered = trimmed.match(/^\d+\.\s+(.*)/);
    const heading = trimmed.match(/^#{1,4}\s+(.*)/);

    if (trimmed.length > 1 && trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeList();
      const cells = trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
      const isSeparator = cells.every((cell) => /^:?-+:?$/.test(cell));
      if (!isSeparator) {
        if (!tableRows) tableRows = [];
        tableRows.push(cells);
      }
      return;
    }
    closeTable();

    if (bullet || ordered) {
      const tag = bullet ? "ul" : "ol";
      if (listTag !== tag) {
        closeList();
        html.push(`<${tag}>`);
        listTag = tag;
      }
      html.push(`<li>${caddieInline((bullet || ordered)[1])}</li>`);
      return;
    }
    closeList();
    if (!trimmed) return;
    if (heading) {
      html.push(`<p class="caddie-heading">${caddieInline(heading[1])}</p>`);
      return;
    }
    html.push(`<p>${caddieInline(trimmed)}</p>`);
  });
  closeList();
  closeTable();
  return html.join("");
}

function renderCaddie() {
  const container = document.querySelector("#caddieMessages");
  if (!container) return;
  container.innerHTML = "";

  if (!caddieReady()) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "請先到「提醒與 AI」完成 Supabase 連線並登入，Felix 才能讀取你的週計畫與 CRM。";
    container.append(note);
    return;
  }

  if (!caddieMessages.length) {
    const mode = currentCaddieMode();
    const empty = document.createElement("div");
    empty.className = "caddie-empty";
    const text = document.createElement("p");
    text.className = "note";
    text.textContent = mode.empty;
    empty.append(text);
    if (mode.start) {
      const startButton = document.createElement("button");
      startButton.type = "button";
      startButton.className = "primary-button";
      startButton.textContent = mode.start;
      startButton.addEventListener("click", () => sendCaddieMessage("我們開始吧。"));
      empty.append(startButton);
    }
    container.append(empty);
    return;
  }

  caddieMessages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `caddie-bubble caddie-${message.role}`;
    if (message.role === "assistant") {
      bubble.innerHTML = renderCaddieMarkdown(message.content);
    } else {
      bubble.textContent = message.content;
    }
    container.append(bubble);
  });

  if (caddieSending) {
    const pending = document.createElement("div");
    pending.className = "caddie-bubble caddie-assistant caddie-pending";
    pending.textContent = "Felix 思考中⋯";
    container.append(pending);
  }

  container.scrollTop = container.scrollHeight;
}

async function sendCaddieMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed || caddieSending || !caddieReady()) return;

  caddieMessages.push({ role: "user", content: trimmed });
  caddieSending = true;
  persistCaddieMessages();
  renderCaddie();

  try {
    const { data, error } = await supabaseClient.functions.invoke("caddie-chat", {
      body: { messages: caddieMessages, mode: caddieMode },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    caddieMessages.push({ role: "assistant", content: data.reply });
  } catch (error) {
    caddieMessages.push({
      role: "assistant",
      content: `（出錯了：${error.message || error}。請稍後再試。）`,
    });
  } finally {
    caddieSending = false;
    persistCaddieMessages();
    renderCaddie();
  }
}

// ── Felix 檢視：看各模式部署中的 system prompt，與各 playbook 的「出廠版 vs 雲端實際讀的版本」
let caddieInspectData = null; // { modes: { [id]: { label, system_prompt, tools } }, playbook_seeds }

async function openCaddieInspect() {
  const dialog = document.querySelector("#caddieInspectDialog");
  const body = document.querySelector("#caddieInspectBody");
  const meta = document.querySelector("#caddieInspectMeta");
  dialog.showModal();
  meta.textContent = "";
  if (!caddieReady()) {
    body.textContent = "請先到「提醒與 AI」完成 Supabase 連線並登入，才能讀取 Felix 的設定。";
    caddieInspectData = null;
    return;
  }
  body.textContent = "載入中…";
  // 每次開啟都重抓，確保部署後看到的是最新的 prompt
  const { data, error } = await supabaseClient.functions.invoke("caddie-chat", {
    body: { action: "get_prompt" },
  });
  if (error || data?.error) {
    body.textContent = `載入失敗：${error?.message || data?.error}`;
    caddieInspectData = null;
    return;
  }
  caddieInspectData = data;
  await renderCaddieInspect();
}

async function renderCaddieInspect() {
  if (!caddieInspectData) return;
  const target = document.querySelector("#caddieInspectTarget").value;
  const body = document.querySelector("#caddieInspectBody");
  const meta = document.querySelector("#caddieInspectMeta");

  if (target.startsWith("mode:")) {
    const entry = caddieInspectData.modes?.[target.slice(5)];
    body.innerHTML = renderCaddieMarkdown(entry?.system_prompt || "（空）");
    meta.textContent = entry
      ? `「${entry.label}」模式部署中的 system prompt（核心＋模式段落＋用字）· 開放工具：${entry.tools.join("、")}`
      : "找不到這個模式。";
    return;
  }

  // playbook：先備好出廠版，再去雲端看 Felix 實際讀的那份
  const seed = caddieInspectData.playbook_seeds?.[target] || "（出廠版找不到這份 playbook）";
  body.textContent = "讀取雲端版…";
  const { data, error } = await supabaseClient
    .from("caddie_playbooks")
    .select("content, updated_at")
    .eq("name", target)
    .maybeSingle();
  if (error) {
    body.innerHTML = renderCaddieMarkdown(seed);
    meta.textContent = `雲端讀取失敗（${error.message}）。以下顯示出廠版。`;
    return;
  }
  if (data?.content) {
    body.innerHTML = renderCaddieMarkdown(data.content);
    meta.textContent = `雲端版（Felix 實際讀的就是這份）· 最後更新 ${new Date(data.updated_at).toLocaleString("zh-TW")}`;
  } else {
    body.innerHTML = renderCaddieMarkdown(seed);
    meta.textContent = "出廠預設 · 雲端還沒有複本（Felix 第一次讀到這份時才會複印過去）。";
  }
}

function bindCaddie() {
  const input = document.querySelector("#caddieInput");
  const sendButton = document.querySelector("#caddieSendBtn");
  const clearButton = document.querySelector("#caddieClearBtn");
  const navButton = document.querySelector('[data-view="caddie"]');
  if (!input || !sendButton) return;

  input.placeholder = currentCaddieMode().placeholder;
  document.querySelectorAll("[data-caddie-mode]").forEach((button) => {
    button.addEventListener("click", () => switchCaddieMode(button.dataset.caddieMode));
  });
  renderCaddieModes();

  const submit = () => {
    const value = input.value;
    input.value = "";
    sendCaddieMessage(value);
  };

  sendButton.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    // 輸入法組字中（選字的 Enter）不送出；keyCode 229 是 Safari 的相容寫法
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  clearButton?.addEventListener("click", () => {
    caddieMessages = [];
    persistCaddieMessages();
    renderCaddie();
  });
  navButton?.addEventListener("click", renderCaddie);

  document.querySelector("#caddieInspectBtn")?.addEventListener("click", openCaddieInspect);
  document.querySelector("#caddieInspectTarget")?.addEventListener("change", renderCaddieInspect);
  document.querySelector("#closeCaddieInspectBtn")?.addEventListener("click", () => {
    document.querySelector("#caddieInspectDialog").close();
  });
}

loadCaddieMessages();
document.addEventListener("DOMContentLoaded", bindCaddie);
if (document.readyState !== "loading") bindCaddie();
