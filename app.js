const dayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const hours = Array.from({ length: 17 }, (_, index) => index + 6);
const renewalAreas = ["生理", "心智", "靈性", "社會情感"];
const emotions = ["喜悅", "感恩", "寧靜", "興趣", "希望", "自豪", "逗趣", "激勵", "敬畏", "愛"];
const goalSlots = 3;
const roleSlots = 2;
const importantSlots = 5;
const roleColors = ["#800000", "#000080", "#808000", "#800080", "#008080", "#c0c0c0"];
const scheduleStartHour = 6;
const scheduleEndHour = 23;
const hourHeightPx = 72;
const timeSnapMinutes = 5;
const defaultRoles = [
  { roles: ["個人發展", "身心健全"], goals: ["", "", ""], color: roleColors[0] },
  { roles: ["基督徒", "神忠實的管家"], goals: ["", "", ""], color: roleColors[1] },
  { roles: ["財務教練", "受人信任，帶人覺察"], goals: ["", "", ""], color: roleColors[2] },
  { roles: ["企業家", "打造 AI 賦能高效團隊"], goals: ["", "", ""], color: roleColors[3] },
  { roles: ["家人", "氣氛和睦感情深厚"], goals: ["", "", ""], color: roleColors[4] },
  { roles: ["內容創作者", "打造有影響力品牌"], goals: ["", "", ""], color: roleColors[5] }
];

const storageKey = "begin-with-end-week-plan";
const supabaseSettingsKey = "begin-with-end-supabase-settings";
let state = loadState();
let reminderTimer = null;
let deferredInstallPrompt = null;
let supabaseClient = null;
let supabaseSession = null;
let cloudSaveTimer = null;

function getSunday(date = new Date()) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function toDateInputValue(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function createEmptyWeek(startDate = getSunday()) {
  return {
    weekStart: toDateInputValue(startDate),
    roles: structuredClone(defaultRoles),
    important: Array.from({ length: 7 }, () => Array(importantSlots).fill("")),
    schedule: [],
    renewal: Object.fromEntries(renewalAreas.map((area) => [area, ""])),
    emotions: Object.fromEntries(emotions.map((name) => [name, { score: 0, note: "" }])),
    weeklyReview: "",
    settings: {
      reminderTime: "21:30",
      reminderEnabled: false,
      aiMode: "local",
      apiKey: "",
      supabase: {
        url: "",
        anonKey: "",
        email: ""
      }
    }
  };
}

function normalizeGoals(item) {
  const roleLabels = new Set([
    "身心健全",
    "神忠實的管家",
    "受人信任，帶人覺察",
    "打造 AI 賦能高效團隊",
    "打造AI賦能高效團隊",
    "氣氛和睦感情深厚",
    "打造有影響力品牌",
    "每日行程",
    "個人成長"
  ]);
  const clean = (values) => values.filter((value) => value && !roleLabels.has(value));
  if (Array.isArray(item.goals)) {
    return [...clean(item.goals), ...Array(goalSlots).fill("")].slice(0, goalSlots);
  }
  if ("goal" in item) {
    return [...clean([item.goal]), ...Array(goalSlots).fill("")].slice(0, goalSlots);
  }
  return Array(goalSlots).fill("");
}

function normalizeRoleLabels(item) {
  if (Array.isArray(item.roles)) {
    return [...item.roles, ...Array(roleSlots).fill("")].slice(0, roleSlots);
  }
  return [item.role || "", ""];
}

function normalizeHexColor(color, fallback) {
  if (typeof color !== "string") return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return fallback;
}

function migrateLegacyRoles(roles) {
  const source = Array.isArray(roles) ? roles : defaultRoles;
  const migrated = [];

  if (source.some((item) => Array.isArray(item?.roles))) {
    return source.map((item, index) => {
      const roleLabels = normalizeRoleLabels(item);
      const goals = normalizeGoals(item);
      return { roles: roleLabels, goals, color: normalizeHexColor(item.color, roleColors[index % roleColors.length]) };
    });
  }

  const pairedSecondRoles = {
    個人發展: "身心健全",
    基督徒: "神忠實的管家",
    財務教練: "受人信任，帶人覺察",
    企業家: "打造 AI 賦能高效團隊",
    家人: "氣氛和睦感情深厚",
    內容創作者: "打造有影響力品牌"
  };

  const consumed = new Set();
  source.forEach((item, index) => {
    if (consumed.has(index)) return;
    const firstRole = item?.role || "";
    const expectedSecond = pairedSecondRoles[firstRole];
    if (expectedSecond) {
      const secondIndex = source.findIndex((candidate, candidateIndex) => (
        candidateIndex > index && candidate?.role === expectedSecond
      ));
      if (secondIndex !== -1) consumed.add(secondIndex);
      const goals = normalizeGoals(item);
      migrated.push({ roles: [firstRole, expectedSecond], goals, color: roleColors[migrated.length % roleColors.length] });
      return;
    }
    migrated.push({ roles: normalizeRoleLabels(item), goals: normalizeGoals(item), color: roleColors[migrated.length % roleColors.length] });
  });

  return migrated.length ? migrated : structuredClone(defaultRoles);
}

function normalizeImportant(important) {
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const day = Array.isArray(important?.[dayIndex]) ? important[dayIndex] : [important?.[dayIndex] || ""];
    return [...day, ...Array(importantSlots).fill("")].slice(0, importantSlots);
  });
}

function minutesToTime(minutes) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSchedule(schedule) {
  if (!Array.isArray(schedule)) return [];
  if (schedule.every((event) => event && typeof event === "object" && "dayIndex" in event)) {
    return schedule.map((event) => ({
      id: event.id || crypto.randomUUID(),
      title: event.title || "",
      dayIndex: Number(event.dayIndex) || 0,
      start: event.start || "06:00",
      end: event.end || "07:00",
      roleIndex: Number(event.roleIndex) || 0
    }));
  }

  const events = [];
  schedule.forEach((row, hourIndex) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, dayIndex) => {
      if (!value || !String(value).trim()) return;
      const startMinutes = (hours[hourIndex] || 6) * 60;
      events.push({
        id: crypto.randomUUID(),
        title: String(value),
        dayIndex,
        start: minutesToTime(startMinutes),
        end: minutesToTime(startMinutes + 60),
        roleIndex: 0
      });
    });
  });
  return events;
}

function normalizeState(data) {
  const base = createEmptyWeek();
  const merged = { ...base, ...data };
  return {
    ...merged,
    roles: migrateLegacyRoles(merged.roles),
    important: normalizeImportant(merged.important),
    schedule: normalizeSchedule(merged.schedule),
    renewal: { ...base.renewal, ...merged.renewal },
    emotions: { ...base.emotions, ...merged.emotions },
    settings: { ...base.settings, ...merged.settings }
  };
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return createEmptyWeek();
  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return createEmptyWeek();
  }
}

function saveState(showToast = false) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (showToast) {
    const button = document.querySelector("#saveBtn");
    button.textContent = "已儲存";
    setTimeout(() => {
      button.textContent = "儲存";
    }, 900);
  }
  updateStats();
  scheduleReminder();
  queueCloudSave();
}

function loadSupabaseSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(supabaseSettingsKey) || "{}");
    const legacy = state.settings?.supabase || {};
    return {
      url: saved.url || legacy.url || "",
      anonKey: saved.anonKey || legacy.anonKey || "",
      email: saved.email || legacy.email || ""
    };
  } catch {
    return { url: "", anonKey: "", email: "" };
  }
}

function saveSupabaseSettings(settings) {
  localStorage.setItem(supabaseSettingsKey, JSON.stringify(settings));
  state.settings.supabase = settings;
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function getPlanPayload() {
  return {
    ...state,
    settings: {
      ...state.settings,
      apiKey: "",
      supabase: {
        url: "",
        anonKey: "",
        email: state.settings.supabase?.email || ""
      }
    }
  };
}

function setSupabaseStatus(message) {
  const status = document.querySelector("#supabaseStatus");
  if (status) status.textContent = message;
}

function isSupabaseConfigured() {
  const settings = loadSupabaseSettings();
  return Boolean(settings.url && settings.anonKey);
}

async function initializeSupabase() {
  const settings = loadSupabaseSettings();
  state.settings.supabase = settings;
  syncSupabaseControls();

  if (!settings.url || !settings.anonKey) {
    setSupabaseStatus("尚未連線；目前資料只存在此瀏覽器。");
    return;
  }
  if (!window.supabase?.createClient) {
    setSupabaseStatus("Supabase SDK 尚未載入；請確認網路連線後重新整理。");
    return;
  }

  supabaseClient = window.supabase.createClient(settings.url, settings.anonKey);
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setSupabaseStatus(`Supabase 連線失敗：${error.message}`);
    return;
  }

  supabaseSession = data.session;
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    supabaseSession = session;
    updateSupabaseStatus();
  });
  updateSupabaseStatus();
}

function updateSupabaseStatus(extraMessage = "") {
  if (!isSupabaseConfigured()) {
    setSupabaseStatus("尚未連線；目前資料只存在此瀏覽器。");
    return;
  }
  if (!supabaseSession?.user) {
    setSupabaseStatus(extraMessage || "Supabase 已設定。請用 Email 登入後開始同步。");
    return;
  }
  const email = supabaseSession.user.email || "已登入使用者";
  setSupabaseStatus(extraMessage || `已登入 ${email}；本週資料會自動同步到 Supabase。`);
}

function queueCloudSave() {
  if (!supabaseClient || !supabaseSession?.user) return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    savePlanToCloud();
  }, 700);
}

async function savePlanToCloud(showStatus = false) {
  if (!supabaseClient || !supabaseSession?.user) return false;
  const payload = {
    user_id: supabaseSession.user.id,
    week_start: state.weekStart,
    plan: getPlanPayload(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseClient
    .from("weekly_plans")
    .upsert(payload, { onConflict: "user_id,week_start" });
  if (error) {
    setSupabaseStatus(`同步失敗：${error.message}`);
    return false;
  }
  if (showStatus) updateSupabaseStatus("已同步到 Supabase。");
  return true;
}

async function loadPlanFromCloud() {
  if (!supabaseClient || !supabaseSession?.user) {
    updateSupabaseStatus("請先登入 Supabase，再從雲端載入。");
    return;
  }

  const { data, error } = await supabaseClient
    .from("weekly_plans")
    .select("plan, updated_at")
    .eq("user_id", supabaseSession.user.id)
    .eq("week_start", state.weekStart)
    .maybeSingle();

  if (error) {
    setSupabaseStatus(`載入失敗：${error.message}`);
    return;
  }
  if (!data?.plan) {
    updateSupabaseStatus("雲端還沒有這週資料；已保留本機版本。");
    return;
  }

  const settings = loadSupabaseSettings();
  state = normalizeState(data.plan);
  state.settings.supabase = settings;
  renderAll();
  localStorage.setItem(storageKey, JSON.stringify(state));
  updateSupabaseStatus(`已載入雲端資料。最後更新：${new Date(data.updated_at).toLocaleString("zh-TW")}`);
}

function bindNavigation() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
      updateStats();
    });
  });
}

function renderWeekHeaders() {
  const start = new Date(`${state.weekStart}T00:00:00`);
  const headers = document.querySelector("#dayHeaders");
  headers.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "day-header day-header-spacer";
  headers.append(spacer);
  dayNames.forEach((dayName, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const item = document.createElement("div");
    item.className = "day-header";
    item.innerHTML = `<strong>${dayName}</strong><span>${formatDate(date)}</span>`;
    headers.append(item);
  });
}

function renderRoles() {
  const list = document.querySelector("#rolesList");
  list.innerHTML = "";
  state.roles.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "role-item";
    row.style.setProperty("--role-color", getRoleColor(index));

    const roleList = document.createElement("div");
    roleList.className = "role-label-list";
    roleList.contentEditable = "true";
    roleList.textContent = item.roles.filter(Boolean).join("\n");
    roleList.dataset.placeholder = "角色/身份";
    roleList.addEventListener("input", () => {
      const values = roleList.innerText.split("\n").map((value) => value.trim()).filter(Boolean);
      state.roles[index].roles = [...values, ...Array(roleSlots).fill("")].slice(0, roleSlots);
      saveState();
    });

    const editColor = document.createElement("button");
    editColor.type = "button";
    editColor.className = "role-color-edit";
    editColor.textContent = "✎";
    editColor.title = "編輯背景色";
    editColor.setAttribute("aria-label", "編輯背景色");
    editColor.addEventListener("click", () => openRoleColorEditor(index));

    const roleCard = document.createElement("div");
    roleCard.className = "role-card";
    roleCard.append(roleList, editColor);

    const goals = document.createElement("div");
    goals.className = "goal-list";
    item.goals.forEach((value, goalIndex) => {
      const goal = document.createElement("input");
      goal.value = value;
      goal.placeholder = `目標 ${goalIndex + 1}`;
      goal.addEventListener("input", () => {
        state.roles[index].goals[goalIndex] = goal.value;
        saveState();
      });
      goals.append(goal);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "刪除";
    remove.addEventListener("click", () => {
      state.roles.splice(index, 1);
      renderRoles();
      saveState();
    });

    row.append(roleCard, goals, remove);
    list.append(row);
  });
}

function openRoleColorEditor(index) {
  const dialog = document.querySelector("#roleColorDialog");
  const color = getRoleColor(index);
  document.querySelector("#roleColorIndex").value = String(index);
  document.querySelector("#roleColorText").value = color;
  document.querySelector("#roleColorPicker").value = color;
  dialog.showModal();
}

function closeRoleColorEditor() {
  document.querySelector("#roleColorDialog").close();
}

function saveRoleColor() {
  const index = Number(document.querySelector("#roleColorIndex").value);
  const normalized = normalizeHexColor(document.querySelector("#roleColorText").value, getRoleColor(index));
  state.roles[index].color = normalized;
  closeRoleColorEditor();
  renderRoles();
  renderSchedule();
  saveState();
}

function renderImportantInputs() {
  const container = document.querySelector("#importantInputs");
  container.innerHTML = "";
  state.important.forEach((items, dayIndex) => {
    const day = document.createElement("div");
    day.className = "important-day";
    items.forEach((value, itemIndex) => {
      const input = document.createElement("input");
      input.value = value;
      input.placeholder = `要事 ${itemIndex + 1}`;
      input.addEventListener("input", () => {
        state.important[dayIndex][itemIndex] = input.value;
        saveState();
      });
      day.append(input);
    });
    container.append(day);
  });
}

function renderSchedule() {
  const grid = document.querySelector("#scheduleGrid");
  grid.innerHTML = "";

  const timeline = document.createElement("div");
  timeline.className = "calendar-time-axis";
  timeline.style.height = `${(scheduleEndHour - scheduleStartHour) * hourHeightPx}px`;
  for (let hour = scheduleStartHour; hour <= scheduleEndHour; hour += 1) {
    const time = document.createElement("div");
    time.className = "calendar-time-label";
    time.style.top = `${(hour - scheduleStartHour) * hourHeightPx}px`;
    time.textContent = `${String(hour).padStart(2, "0")}:00`;
    timeline.append(time);
  }
  grid.append(timeline);

  dayNames.forEach((_, dayIndex) => {
    const column = document.createElement("div");
    column.className = "calendar-day-column";
    column.tabIndex = 0;
    column.dataset.dayIndex = dayIndex;
    column.style.height = `${(scheduleEndHour - scheduleStartHour) * hourHeightPx}px`;
    column.addEventListener("click", (event) => {
      const start = timeFromCalendarClick(event, column);
      openScheduleEditor({ dayIndex, start });
    });
    column.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openScheduleEditor({ dayIndex, start: `${String(scheduleStartHour).padStart(2, "0")}:00` });
    });

    state.schedule
      .filter((event) => event.dayIndex === dayIndex)
      .forEach((calendarEvent) => {
        const item = document.createElement("button");
        const startMinutes = Math.max(timeToMinutes(calendarEvent.start), scheduleStartHour * 60);
        const endMinutes = Math.min(timeToMinutes(calendarEvent.end), scheduleEndHour * 60);
        const top = ((startMinutes - scheduleStartHour * 60) / 60) * hourHeightPx;
        const height = Math.max(((endMinutes - startMinutes) / 60) * hourHeightPx, 22);

        item.type = "button";
        item.className = "schedule-event";
        item.style.backgroundColor = getRoleColor(calendarEvent.roleIndex);
        item.style.top = `${top}px`;
        item.style.height = `${height}px`;
        item.innerHTML = `<strong>${calendarEvent.title || "未命名行程"}</strong><span>${calendarEvent.start}-${calendarEvent.end}</span>`;
        item.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          openScheduleEditor({ eventId: calendarEvent.id });
        });
        column.append(item);
      });

    grid.append(column);
  });
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return (hour * 60) + minute;
}

function timeFromCalendarClick(event, column) {
  const rect = column.getBoundingClientRect();
  const rawMinutes = scheduleStartHour * 60 + ((event.clientY - rect.top) / hourHeightPx) * 60;
  const snapped = Math.round(rawMinutes / timeSnapMinutes) * timeSnapMinutes;
  const min = scheduleStartHour * 60;
  const max = (scheduleEndHour * 60) - timeSnapMinutes;
  return minutesToTime(Math.max(min, Math.min(max, snapped)));
}

function getRoleGroupName(index) {
  return state.roles[index]?.roles.filter(Boolean).join(" / ") || `角色組 ${index + 1}`;
}

function getRoleColor(index) {
  return normalizeHexColor(state.roles[index]?.color, roleColors[index % roleColors.length]);
}

function syncRoleOptions() {
  const select = document.querySelector("#scheduleRole");
  select.innerHTML = "";
  state.roles.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = getRoleGroupName(index);
    select.append(option);
  });
}

function openScheduleEditor({ dayIndex = 0, start: startTime = null, eventId = null }) {
  syncRoleOptions();
  const dialog = document.querySelector("#scheduleDialog");
  const event = eventId ? state.schedule.find((item) => item.id === eventId) : null;
  const start = event?.start || startTime || `${String(scheduleStartHour).padStart(2, "0")}:00`;
  const end = event?.end || minutesToTime(Math.min(timeToMinutes(start) + 60, scheduleEndHour * 60));

  document.querySelector("#scheduleEventId").value = event?.id || "";
  document.querySelector("#scheduleDay").value = String(event?.dayIndex ?? dayIndex);
  document.querySelector("#scheduleTitle").value = event?.title || "";
  document.querySelector("#scheduleStart").value = start;
  document.querySelector("#scheduleEnd").value = end;
  document.querySelector("#scheduleRole").value = String(event?.roleIndex ?? 0);
  document.querySelector("#deleteScheduleBtn").hidden = !event;
  dialog.showModal();
}

function closeScheduleEditor() {
  document.querySelector("#scheduleDialog").close();
}

function saveScheduleEvent() {
  const id = document.querySelector("#scheduleEventId").value || crypto.randomUUID();
  const start = document.querySelector("#scheduleStart").value;
  const end = document.querySelector("#scheduleEnd").value;
  if (timeToMinutes(end) <= timeToMinutes(start)) {
    alert("結束時間需要晚於開始時間。");
    return;
  }

  const event = {
    id,
    title: document.querySelector("#scheduleTitle").value.trim(),
    dayIndex: Number(document.querySelector("#scheduleDay").value),
    start,
    end,
    roleIndex: Number(document.querySelector("#scheduleRole").value)
  };
  const index = state.schedule.findIndex((item) => item.id === id);
  if (index >= 0) state.schedule[index] = event;
  else state.schedule.push(event);
  closeScheduleEditor();
  renderSchedule();
  saveState();
}

function deleteScheduleEvent() {
  const id = document.querySelector("#scheduleEventId").value;
  state.schedule = state.schedule.filter((event) => event.id !== id);
  closeScheduleEditor();
  renderSchedule();
  saveState();
}

function renderRenewal() {
  const grid = document.querySelector("#renewalGrid");
  grid.innerHTML = "";
  renewalAreas.forEach((area) => {
    const label = document.createElement("label");
    label.innerHTML = `<span>${area}</span>`;
    const textarea = document.createElement("textarea");
    textarea.value = state.renewal[area] || "";
    textarea.placeholder = `${area}更新計畫`;
    textarea.addEventListener("input", () => {
      state.renewal[area] = textarea.value;
      saveState();
    });
    label.append(textarea);
    grid.append(label);
  });
}

function renderEmotions() {
  const grid = document.querySelector("#emotionGrid");
  grid.innerHTML = "";
  emotions.forEach((name) => {
    const item = state.emotions[name] || { score: 0, note: "" };
    const block = document.createElement("article");
    block.className = "emotion-item";
    block.innerHTML = `
      <header>
        <strong>${name}</strong>
        <output>${item.score}</output>
      </header>
    `;

    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "10";
    range.value = item.score;

    const note = document.createElement("textarea");
    note.placeholder = `本週哪個片刻讓你感到${name}？`;
    note.value = item.note;

    range.addEventListener("input", () => {
      state.emotions[name].score = Number(range.value);
      block.querySelector("output").textContent = range.value;
      saveState();
    });
    note.addEventListener("input", () => {
      state.emotions[name].note = note.value;
      saveState();
    });

    block.append(range, note);
    grid.append(block);
  });
}

function syncSettingsControls() {
  const reminderTime = document.querySelector("#reminderTime");
  const reminderEnabled = document.querySelector("#reminderEnabled");
  const aiMode = document.querySelector("#aiMode");
  const apiKey = document.querySelector("#apiKey");
  const weeklyReview = document.querySelector("#weeklyReview");

  reminderTime.value = state.settings.reminderTime;
  reminderEnabled.checked = state.settings.reminderEnabled;
  aiMode.value = state.settings.aiMode;
  apiKey.value = state.settings.apiKey;
  weeklyReview.value = state.weeklyReview;
  syncSupabaseControls();
}

function syncSupabaseControls() {
  const settings = loadSupabaseSettings();
  const supabaseUrl = document.querySelector("#supabaseUrl");
  const supabaseAnonKey = document.querySelector("#supabaseAnonKey");
  const supabaseEmail = document.querySelector("#supabaseEmail");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseEmail) return;

  supabaseUrl.value = settings.url;
  supabaseAnonKey.value = settings.anonKey;
  supabaseEmail.value = settings.email;
}

function bindSettings() {
  const reminderTime = document.querySelector("#reminderTime");
  const reminderEnabled = document.querySelector("#reminderEnabled");
  const aiMode = document.querySelector("#aiMode");
  const apiKey = document.querySelector("#apiKey");
  const weeklyReview = document.querySelector("#weeklyReview");

  reminderTime.addEventListener("input", () => {
    state.settings.reminderTime = reminderTime.value;
    saveState();
  });
  reminderEnabled.addEventListener("change", async () => {
    state.settings.reminderEnabled = reminderEnabled.checked;
    if (reminderEnabled.checked) await requestNotificationPermission();
    saveState();
  });
  aiMode.addEventListener("change", () => {
    state.settings.aiMode = aiMode.value;
    saveState();
  });
  apiKey.addEventListener("input", () => {
    state.settings.apiKey = apiKey.value;
    saveState();
  });
  weeklyReview.addEventListener("input", () => {
    state.weeklyReview = weeklyReview.value;
    saveState();
  });

  document.querySelector("#saveSupabaseBtn").addEventListener("click", async () => {
    const settings = {
      url: document.querySelector("#supabaseUrl").value.trim(),
      anonKey: document.querySelector("#supabaseAnonKey").value.trim(),
      email: document.querySelector("#supabaseEmail").value.trim()
    };
    saveSupabaseSettings(settings);
    setSupabaseStatus("正在連線 Supabase...");
    await initializeSupabase();
  });

  document.querySelector("#sendMagicLinkBtn").addEventListener("click", async () => {
    const settings = {
      url: document.querySelector("#supabaseUrl").value.trim(),
      anonKey: document.querySelector("#supabaseAnonKey").value.trim(),
      email: document.querySelector("#supabaseEmail").value.trim()
    };
    saveSupabaseSettings(settings);
    await initializeSupabase();

    if (!supabaseClient || !settings.email) {
      setSupabaseStatus("請先填入 Supabase URL、anon key 和 Email。");
      return;
    }

    const { error } = await supabaseClient.auth.signInWithOtp({
      email: settings.email,
      options: { emailRedirectTo: window.location.href.split("#")[0] }
    });
    if (error) {
      setSupabaseStatus(`登入連結寄送失敗：${error.message}`);
      return;
    }
    setSupabaseStatus(`登入連結已寄到 ${settings.email}。請用同一個瀏覽器開啟信中的連結。`);
  });

  document.querySelector("#syncFromCloudBtn").addEventListener("click", loadPlanFromCloud);
  document.querySelector("#signOutBtn").addEventListener("click", async () => {
    if (supabaseClient) await supabaseClient.auth.signOut();
    supabaseSession = null;
    updateSupabaseStatus("已登出 Supabase；本機資料仍保留。");
  });
}

function updateStats() {
  const importantFilled = state.important.flat().filter((item) => item.trim()).length;
  const scheduleFilled = state.schedule.length;
  const emotionScores = Object.values(state.emotions).map((item) => Number(item.score || 0));
  const emotionAverage = emotionScores.reduce((sum, score) => sum + score, 0) / emotionScores.length;
  const renewalFilled = Object.values(state.renewal).filter((item) => item.trim()).length;

  document.querySelector("#importantRate").textContent = `${Math.round((importantFilled / (7 * importantSlots)) * 100)}%`;
  document.querySelector("#scheduleCount").textContent = String(scheduleFilled);
  document.querySelector("#emotionAverage").textContent = emotionAverage.toFixed(1);
  document.querySelector("#renewalCount").textContent = `${renewalFilled}/4`;
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("這個瀏覽器不支援通知。");
    return false;
  }
  if (Notification.permission === "granted") return true;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function notify(message) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("以終為始週計畫表", { body: message });
  } else {
    alert(message);
  }
}

function scheduleReminder() {
  if (reminderTimer) clearTimeout(reminderTimer);
  if (!state.settings.reminderEnabled || !state.settings.reminderTime) return;

  const [hour, minute] = state.settings.reminderTime.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  reminderTimer = setTimeout(() => {
    notify("現在可以花 3 分鐘更新今日要事、行程與正向情緒。");
    scheduleReminder();
  }, next - now);
}

function generateFeedback() {
  updateStats();
  const importantFilled = state.important.flat().filter((item) => item.trim()).length;
  const scheduleFilled = state.schedule.length;
  const topEmotion = Object.entries(state.emotions)
    .sort((a, b) => Number(b[1].score) - Number(a[1].score))[0];
  const renewalFilled = Object.entries(state.renewal)
    .filter(([, value]) => value.trim())
    .map(([area]) => area);

  const feedback = [
    `本週你已經填寫 ${importantFilled}/35 格今日要事，行程格共有 ${scheduleFilled} 格有安排。`,
    topEmotion && Number(topEmotion[1].score) > 0
      ? `目前最明顯的正向情緒是「${topEmotion[0]}」，可以回頭看看是哪個事件帶來這種感受，讓它下週更容易重現。`
      : "目前正向情緒尚未累積分數，可以先從今天最微小的一個好感受開始記錄。",
    renewalFilled.length
      ? `你已經照顧到 ${renewalFilled.join("、")}，週末回顧時可以檢查這些安排是否真的補充了能量。`
      : "精益求精四個面向還沒有內容，建議先各寫下一個小行動，讓週計畫更平衡。",
    state.settings.aiMode === "api"
      ? "正式接 API 時，可以把角色目標、每日要事、情緒分數與週回顧送到後端，再由 AI 產生更個人化的建議。"
      : "目前這是本機規則產生的草稿，不會把資料送出瀏覽器。"
  ].join("\n\n");

  document.querySelector("#aiFeedback").textContent = feedback;
}

function bindActions() {
  document.querySelector("#weekStart").value = state.weekStart;
  document.querySelector("#weekStart").addEventListener("change", (event) => {
    state.weekStart = event.target.value;
    renderWeekHeaders();
    saveState();
  });

  document.querySelector("#addRoleBtn").addEventListener("click", () => {
    state.roles.push({ roles: ["", ""], goals: ["", "", ""], color: roleColors[state.roles.length % roleColors.length] });
    renderRoles();
    saveState();
  });

  document.querySelector("#newWeekBtn").addEventListener("click", () => {
    const start = new Date(`${state.weekStart}T00:00:00`);
    start.setDate(start.getDate() + 7);
    const next = createEmptyWeek(start);
    next.roles = structuredClone(state.roles);
    next.settings = structuredClone(state.settings);
    state = next;
    renderAll();
    saveState(true);
  });

  document.querySelector("#saveBtn").addEventListener("click", () => saveState(true));
  document.querySelector("#installAppBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.querySelector("#installAppBtn").hidden = true;
  });
  document.querySelector("#testReminderBtn").addEventListener("click", async () => {
    await requestNotificationPermission();
    notify("提醒測試成功。");
  });
  document.querySelector("#aiFeedbackBtn").addEventListener("click", generateFeedback);
  document.querySelector("#scheduleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveScheduleEvent();
  });
  document.querySelector("#cancelScheduleBtn").addEventListener("click", closeScheduleEditor);
  document.querySelector("#deleteScheduleBtn").addEventListener("click", deleteScheduleEvent);
  document.querySelector("#roleColorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveRoleColor();
  });
  document.querySelector("#cancelRoleColorBtn").addEventListener("click", closeRoleColorEditor);
  document.querySelector("#roleColorPicker").addEventListener("input", (event) => {
    document.querySelector("#roleColorText").value = event.target.value;
  });
  document.querySelector("#roleColorText").addEventListener("input", (event) => {
    const value = normalizeHexColor(event.target.value, "");
    if (value) document.querySelector("#roleColorPicker").value = value;
  });
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelector("#installAppBtn").hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    document.querySelector("#installAppBtn").hidden = true;
  });
}

function renderAll() {
  document.querySelector("#weekStart").value = state.weekStart;
  renderWeekHeaders();
  renderRoles();
  renderImportantInputs();
  renderSchedule();
  renderRenewal();
  renderEmotions();
  syncSettingsControls();
  updateStats();
  scheduleReminder();
}

registerPwa();
bindNavigation();
bindSettings();
bindActions();
renderAll();
initializeSupabase();
