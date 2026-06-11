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
    bubble.textContent = message.content;
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
}

loadCaddieMessages();
document.addEventListener("DOMContentLoaded", bindCaddie);
if (document.readyState !== "loading") bindCaddie();
