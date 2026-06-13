// 桿弟：對話介面（Layer 2，呼叫 Supabase Edge Function caddie-chat）
// 依賴 app.js 已定義的全域：supabaseClient、supabaseSession

const caddieStorageKey = "begin-with-end-caddie-chat";

let caddieMessages = [];
let caddieSending = false;

function loadCaddieMessages() {
  try {
    caddieMessages = JSON.parse(sessionStorage.getItem(caddieStorageKey) || "[]");
  } catch {
    caddieMessages = [];
  }
}

function persistCaddieMessages() {
  sessionStorage.setItem(caddieStorageKey, JSON.stringify(caddieMessages));
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

// 把桿弟回覆的 Markdown 子集（粗體、行內代碼、標題、清單、表格）轉成 HTML；先跳脫原文防注入
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
    note.textContent = "請先到「提醒與 AI」完成 Supabase 連線並登入，桿弟才能讀取你的週計畫與 CRM。";
    container.append(note);
    return;
  }

  if (!caddieMessages.length) {
    const empty = document.createElement("div");
    empty.className = "caddie-empty";
    const text = document.createElement("p");
    text.className = "note";
    text.textContent = "還沒開始對話。桿弟開場會先看你的週計畫和 pipeline，給一份進度快照。";
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "primary-button";
    startButton.textContent = "開始本週對話";
    startButton.addEventListener("click", () => sendCaddieMessage("我們開始吧。"));
    empty.append(text, startButton);
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
    pending.textContent = "桿弟思考中⋯";
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
      body: { messages: caddieMessages },
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

// ── 桿弟檢視：看目前部署中的 system prompt，與各 playbook 的「出廠版 vs 雲端實際讀的版本」
let caddieInspectData = null; // { system_prompt, playbook_seeds }

async function openCaddieInspect() {
  const dialog = document.querySelector("#caddieInspectDialog");
  const body = document.querySelector("#caddieInspectBody");
  const meta = document.querySelector("#caddieInspectMeta");
  dialog.showModal();
  meta.textContent = "";
  if (!caddieReady()) {
    body.textContent = "請先到「提醒與 AI」完成 Supabase 連線並登入，才能讀取桿弟的設定。";
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

  if (target === "__prompt__") {
    body.innerHTML = renderCaddieMarkdown(caddieInspectData.system_prompt || "（空）");
    meta.textContent = "目前部署中的 system prompt — 桿弟每次回覆都讀這份，改了部署就生效，沒有雲端複本問題。";
    return;
  }

  // playbook：先備好出廠版，再去雲端看桿弟實際讀的那份
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
    meta.textContent = `雲端版（桿弟實際讀的就是這份）· 最後更新 ${new Date(data.updated_at).toLocaleString("zh-TW")}`;
  } else {
    body.innerHTML = renderCaddieMarkdown(seed);
    meta.textContent = "出廠預設 · 雲端還沒有複本（桿弟第一次讀到這份時才會複印過去）。";
  }
}

function bindCaddie() {
  const input = document.querySelector("#caddieInput");
  const sendButton = document.querySelector("#caddieSendBtn");
  const clearButton = document.querySelector("#caddieClearBtn");
  const navButton = document.querySelector('[data-view="caddie"]');
  if (!input || !sendButton) return;

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
