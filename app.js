const dayNames = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const hours = Array.from({ length: 17 }, (_, index) => index + 6);
const renewalAreas = ["生理", "心智", "靈性", "社會情感"];
const emotions = ["喜悅", "感恩", "寧靜", "興趣", "希望", "自豪", "逗趣", "激勵", "敬畏", "愛"];
const goalSlots = 3;
const roleSlots = 2;
const importantSlots = 5;
const victorySlots = 3;
const weeklyReviewQuestions = [
  "在過去的 7 天裡，你最重要的進展是什麼？",
  "你從中學到了什麼？",
  "在過去的 7 天裡，有什麼事讓你引以為傲？",
  "目前你的感受是什麼呢？",
  "有什麼迫不及待想實施的好想法呢？",
  "回顧上禮拜「你想像最好的自己」，在哪些方面你更前進了呢？",
  "再一個 7 天之後，你所能想像最好的自己是什麼樣子呢？",
  "再問自己一次，你有什麼迫不及待想實施的好想法，讓你往最好的自己前進？"
];
const roleColors = ["#800000", "#000080", "#808000", "#800080", "#008080", "#c0c0c0"];
const officeEventRoleValue = "office-event";
const officeEventColor = "#b42318";
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
const weekStoragePrefix = `${storageKey}:week:`;
const supabaseSettingsKey = "begin-with-end-supabase-settings";
let state = loadState();
let selectedVictoryDate = toDateInputValue(new Date());
let lookbackMode = "daily";
let selectedLookbackDate = toDateInputValue(new Date());
let selectedLookbackRoleIndex = "all";
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
    dailyWins: {},
    weeklyReview: "",
    weeklyReviewAnswers: Array(weeklyReviewQuestions.length).fill(""),
    settings: {
      reminderTime: "21:30",
      reminderEnabled: false,
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
    return [...day, ...Array(importantSlots).fill("")].slice(0, importantSlots).map((item) => {
      if (item && typeof item === "object") {
        return { text: item.text || "", done: Boolean(item.done) };
      }
      return { text: item || "", done: false };
    });
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
      roleIndex: normalizeRoleIndex(event.roleIndex)
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

function normalizeRoleIndex(value) {
  if (value === officeEventRoleValue) return officeEventRoleValue;
  const index = Number(value);
  return Number.isFinite(index) ? index : 0;
}

function createEmptyVictoryDay() {
  const createItem = () => ({ text: "", note: "", roleIndex: "" });
  return {
    today: Array.from({ length: victorySlots }, createItem),
    tomorrow: Array.from({ length: victorySlots }, createItem)
  };
}

function normalizeVictoryItems(items) {
  const source = Array.isArray(items) ? items : [];
  return Array.from({ length: victorySlots }, (_, index) => {
    const item = source[index] || {};
    return {
      text: item.text || item.win || "",
      note: item.note || item.reflection || item.meaning || "",
      roleIndex: item.roleIndex === "" || item.roleIndex === undefined ? "" : normalizeRoleIndex(item.roleIndex)
    };
  });
}

function normalizeDailyWins(dailyWins) {
  if (!dailyWins || typeof dailyWins !== "object") return {};
  return Object.fromEntries(Object.entries(dailyWins).map(([date, value]) => [
    date,
    {
      today: normalizeVictoryItems(value?.today),
      tomorrow: normalizeVictoryItems(value?.tomorrow)
    }
  ]));
}

function normalizeWeeklyReviewAnswers(answers, legacyReview = "") {
  const source = Array.isArray(answers) ? answers : [];
  const normalized = Array.from({ length: weeklyReviewQuestions.length }, (_, index) => source[index] || "");
  if (!normalized.some(Boolean) && legacyReview) normalized[0] = legacyReview;
  return normalized;
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
    dailyWins: normalizeDailyWins(merged.dailyWins),
    weeklyReviewAnswers: normalizeWeeklyReviewAnswers(merged.weeklyReviewAnswers, merged.weeklyReview),
    settings: { ...base.settings, ...merged.settings }
  };
}

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return createEmptyWeek();
  try {
    const current = normalizeState(JSON.parse(saved));
    const weekSaved = localStorage.getItem(getWeekStorageKey(current.weekStart));
    return weekSaved ? normalizeState(JSON.parse(weekSaved)) : current;
  } catch {
    return createEmptyWeek();
  }
}

function getWeekStorageKey(weekStart) {
  return `${weekStoragePrefix}${weekStart}`;
}

function persistStateLocally() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  localStorage.setItem(getWeekStorageKey(state.weekStart), JSON.stringify(state));
}

function loadWeekState(weekStart, carry = {}) {
  const saved = localStorage.getItem(getWeekStorageKey(weekStart));
  if (saved) {
    try {
      return normalizeState(JSON.parse(saved));
    } catch {
      localStorage.removeItem(getWeekStorageKey(weekStart));
    }
  }

  const next = createEmptyWeek(new Date(`${weekStart}T00:00:00`));
  const carriedRoles = carry.roles || state?.roles || defaultRoles;
  next.roles = carriedRoles.map((role, index) => ({
    roles: [...(role.roles || []), ...Array(roleSlots).fill("")].slice(0, roleSlots),
    goals: Array(goalSlots).fill(""),
    color: normalizeHexColor(role.color, roleColors[index % roleColors.length])
  }));
  next.settings = structuredClone(carry.settings || state?.settings || createEmptyWeek().settings);
  return normalizeState(next);
}

function saveState(showToast = false) {
  persistStateLocally();
  if (showToast) {
    const button = document.querySelector("#saveBtn");
    button.textContent = "已儲存";
    setTimeout(() => {
      button.textContent = "儲存";
    }, 900);
  }
  updateStats();
  renderLookback();
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
  persistStateLocally();
}

function getPlanPayload() {
  return {
    ...state,
    settings: {
      ...state.settings,
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
  persistStateLocally();
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
      if (button.dataset.view === "lookback") renderLookback();
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
      renderRoleSettings();
    });

    const roleCard = document.createElement("div");
    roleCard.className = "role-card";
    roleCard.append(roleList);

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

    row.append(roleCard, goals);
    list.append(row);
  });
}

function renderRoleSettings() {
  const list = document.querySelector("#roleSettingsList");
  if (!list) return;
  list.innerHTML = "";

  state.roles.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "role-settings-row";

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.value = getRoleColor(index);
    swatch.title = "角色背景色";
    swatch.setAttribute("aria-label", `${getRoleGroupName(index)} 背景色`);
    swatch.addEventListener("input", () => {
      state.roles[index].color = swatch.value;
      renderRoles();
      renderSchedule();
      saveState();
    });

    const labels = document.createElement("div");
    labels.className = "role-settings-fields";
    item.roles.forEach((value, roleIndex) => {
      const input = document.createElement("input");
      input.value = value;
      input.placeholder = `角色名稱 ${roleIndex + 1}`;
      input.addEventListener("input", () => {
        state.roles[index].roles[roleIndex] = input.value;
        renderRoles();
        saveState();
      });
      labels.append(input);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => removeRole(index));

    row.append(swatch, labels, remove);
    list.append(row);
  });
}

function removeRole(index) {
  state.roles.splice(index, 1);
  state.schedule = state.schedule.map((event) => {
    if (event.roleIndex === index) return { ...event, roleIndex: 0 };
    if (event.roleIndex > index) return { ...event, roleIndex: event.roleIndex - 1 };
    return event;
  });
  renderRoles();
  renderRoleSettings();
  renderSchedule();
  saveState();
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
    items.forEach((item, itemIndex) => {
      const input = document.createElement("input");
      input.value = item.text;
      input.placeholder = `要事 ${itemIndex + 1}`;
      input.addEventListener("input", () => {
        state.important[dayIndex][itemIndex].text = input.value;
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
        item.title = `${calendarEvent.title || "未命名行程"} ${calendarEvent.start}-${calendarEvent.end}`;
        if (height < 36) {
          item.classList.add("tiny-event");
          item.innerHTML = `<strong>${calendarEvent.title || "未命名行程"}</strong>`;
        } else if (height < 58) {
          item.classList.add("compact-event");
          item.innerHTML = `<strong>${calendarEvent.title || "未命名行程"}</strong><span>${calendarEvent.start}-${calendarEvent.end}</span>`;
        } else {
          item.innerHTML = `<strong>${calendarEvent.title || "未命名行程"}</strong><span>${calendarEvent.start}-${calendarEvent.end}</span>`;
        }
        if (calendarEvent.roleIndex === officeEventRoleValue) {
          item.classList.add("office-event");
        } else {
          item.style.backgroundColor = getRoleColor(calendarEvent.roleIndex);
        }
        item.style.top = `${top}px`;
        item.style.height = `${height}px`;
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
  if (index === officeEventRoleValue) return "辦公室事件";
  return state.roles[index]?.roles.filter(Boolean).join(" / ") || `角色組 ${index + 1}`;
}

function getRoleColor(index) {
  if (index === officeEventRoleValue) return officeEventColor;
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

  const officeOption = document.createElement("option");
  officeOption.value = officeEventRoleValue;
  officeOption.textContent = "辦公室事件";
  select.append(officeOption);
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
    roleIndex: parseRoleIndex(document.querySelector("#scheduleRole").value)
  };
  const index = state.schedule.findIndex((item) => item.id === id);
  if (index >= 0) state.schedule[index] = event;
  else state.schedule.push(event);
  closeScheduleEditor();
  renderSchedule();
  saveState();
}

function parseRoleIndex(value) {
  return value === officeEventRoleValue ? officeEventRoleValue : Number(value);
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

function addDaysToDateInput(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function getVictoryDay(dateValue = selectedVictoryDate) {
  if (!state.dailyWins[dateValue]) {
    state.dailyWins[dateValue] = createEmptyVictoryDay();
  }
  return state.dailyWins[dateValue];
}

function renderVictoryRoleSelect(value, onChange) {
  const select = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "不指定角色";
  select.append(empty);

  state.roles.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = getRoleGroupName(index);
    select.append(option);
  });

  select.value = value === "" || value === undefined ? "" : String(value);
  select.addEventListener("change", () => onChange(select.value === "" ? "" : Number(select.value)));
  return select;
}

function renderVictoryItems(container, items, sectionKey) {
  container.innerHTML = "";
  items.forEach((item, index) => {
    const block = document.createElement("article");
    block.className = "victory-item";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = sectionKey === "today" ? `今天的第 ${index + 1} 個勝利` : `明天的第 ${index + 1} 個勝利`;
    header.append(title, renderVictoryRoleSelect(item.roleIndex, (value) => {
      item.roleIndex = value;
      saveState();
    }));

    const text = document.createElement("textarea");
    text.rows = 2;
    text.value = item.text;
    text.placeholder = sectionKey === "today" ? "今天有什麼值得為自己喝采的事？" : "明天想要為自己完成什麼事？";
    text.addEventListener("input", () => {
      item.text = text.value;
      saveState();
    });

    const note = document.createElement("textarea");
    note.rows = 2;
    note.value = item.note;
    note.placeholder = sectionKey === "today" ? "勝利感言" : "對我的意義";
    note.addEventListener("input", () => {
      item.note = note.value;
      saveState();
    });

    block.append(header, text, note);
    container.append(block);
  });
}

function renderVictories() {
  const dateInput = document.querySelector("#victoryDate");
  if (!dateInput) return;
  dateInput.value = selectedVictoryDate;
  const day = getVictoryDay();
  renderVictoryItems(document.querySelector("#todayVictories"), day.today, "today");
  renderVictoryItems(document.querySelector("#tomorrowVictories"), day.tomorrow, "tomorrow");
}

function renderWeeklyReflection() {
  const list = document.querySelector("#weeklyReflectionList");
  if (!list) return;
  list.innerHTML = "";

  weeklyReviewQuestions.forEach((question, index) => {
    const label = document.createElement("label");
    label.className = "reflection-item";
    const prompt = document.createElement("span");
    prompt.textContent = question;
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.value = state.weeklyReviewAnswers[index] || "";
    textarea.placeholder = "寫下你的回顧";
    textarea.addEventListener("input", () => {
      state.weeklyReviewAnswers[index] = textarea.value;
      saveState();
    });
    label.append(prompt, textarea);
    list.append(label);
  });
}

function bindVictoryActions() {
  const dateInput = document.querySelector("#victoryDate");
  dateInput.addEventListener("change", () => {
    selectedVictoryDate = dateInput.value || toDateInputValue(new Date());
    renderVictories();
    saveState();
  });
  document.querySelector("#prevVictoryDayBtn").addEventListener("click", () => {
    selectedVictoryDate = addDaysToDateInput(selectedVictoryDate, -1);
    renderVictories();
  });
  document.querySelector("#nextVictoryDayBtn").addEventListener("click", () => {
    selectedVictoryDate = addDaysToDateInput(selectedVictoryDate, 1);
    renderVictories();
  });
}

function getWeekDates() {
  const start = new Date(`${state.weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toDateInputValue(date);
  });
}

function getDateOffsetInWeek(dateValue) {
  const start = new Date(`${state.weekStart}T00:00:00`);
  const date = new Date(`${dateValue}T00:00:00`);
  return Math.round((date - start) / 86400000);
}

function isFilled(value) {
  return String(value || "").trim().length > 0;
}

function createTextBlock(title, lines) {
  const block = document.createElement("section");
  block.className = "lookback-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "lookback-list";

  const filtered = lines.filter((line) => isFilled(line));
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前還沒有內容。";
    list.append(empty);
  } else {
    filtered.forEach((line) => {
      const item = document.createElement("p");
      item.textContent = line;
      list.append(item);
    });
  }

  block.append(heading, list);
  return block;
}

function createHeadlineBlock(title, subtitle) {
  const block = document.createElement("section");
  block.className = "lookback-panel lookback-headline";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = subtitle;
  block.append(heading, text);
  return block;
}

function createRichBlock(title, items) {
  const block = document.createElement("section");
  block.className = "lookback-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "lookback-list";

  const filtered = items.filter((item) => item.title || item.meta || item.body);
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前還沒有內容。";
    list.append(empty);
  } else {
    filtered.forEach((item) => {
      const row = document.createElement("article");
      row.className = "lookback-item";
      if (item.title) {
        const titleEl = document.createElement("strong");
        titleEl.textContent = item.title;
        row.append(titleEl);
      }
      if (item.meta) {
        const meta = document.createElement("span");
        meta.textContent = item.meta;
        row.append(meta);
      }
      if (item.body) {
        const body = document.createElement("p");
        body.textContent = item.body;
        row.append(body);
      }
      list.append(row);
    });
  }

  block.append(heading, list);
  return block;
}

function createDailyTodoBlock(title, items, dayIndex) {
  const block = document.createElement("section");
  block.className = "lookback-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "todo-list";

  const filtered = items
    .map((item, index) => ({ ...item, index }))
    .filter((item) => isFilled(item.text));

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前還沒有內容。";
    list.append(empty);
  } else {
    filtered.forEach((item) => {
      const label = document.createElement("label");
      label.className = "todo-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      const text = document.createElement("span");
      text.textContent = item.text;
      checkbox.addEventListener("change", () => {
        state.important[dayIndex][item.index].done = checkbox.checked;
        saveState();
      });
      label.append(checkbox, text);
      list.append(label);
    });
  }

  block.append(heading, list);
  return block;
}

function createWeeklyTodoBlock(title, items) {
  const block = document.createElement("section");
  block.className = "lookback-panel";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "todo-list";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前還沒有內容。";
    list.append(empty);
  } else {
    items.forEach((item) => {
      const row = document.createElement("p");
      row.className = item.done ? "todo-readonly done" : "todo-readonly";
      row.textContent = item.label;
      list.append(row);
    });
  }

  block.append(heading, list);
  return block;
}

function getVictoryItemsForDate(dateValue) {
  const day = state.dailyWins[dateValue];
  if (!day) return [];
  return [
    ...day.today.map((item, index) => ({ ...item, label: `今天 ${index + 1}` })),
    ...day.tomorrow.map((item, index) => ({ ...item, label: `明天 ${index + 1}` }))
  ].filter((item) => isFilled(item.text) || isFilled(item.note));
}

function createVictoryCard(title, items, emptyText) {
  const card = document.createElement("details");
  card.className = "lookback-victory-card";

  const summary = document.createElement("summary");
  summary.className = "lookback-victory-summary";
  const summaryText = document.createElement("span");
  summaryText.className = "lookback-victory-title";
  summaryText.textContent = title;
  const count = document.createElement("span");
  count.className = "lookback-victory-count";
  count.textContent = `${items.length} 筆`;
  const arrow = document.createElement("span");
  arrow.className = "lookback-victory-arrow";
  arrow.textContent = "›";
  summary.append(summaryText, count, arrow);

  const content = document.createElement("div");
  content.className = "lookback-victory-content";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    content.append(empty);
  } else {
    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = "lookback-item";
      const titleEl = document.createElement("strong");
      titleEl.textContent = `${item.label}${item.roleIndex !== "" && item.roleIndex !== undefined ? `｜${getRoleGroupName(item.roleIndex)}` : ""}`;
      row.append(titleEl);
      const bodyText = [item.text, item.note].filter(isFilled).join("｜");
      if (bodyText) {
        const body = document.createElement("p");
        body.textContent = bodyText;
        row.append(body);
      }
      content.append(row);
    });
  }

  card.append(summary, content);
  return card;
}

function createDailyVictoryBlock(dateValue) {
  const block = document.createElement("section");
  block.className = "lookback-panel";
  const heading = document.createElement("h3");
  heading.textContent = "三個勝利";
  const list = document.createElement("div");
  list.className = "lookback-victory-list";
  const day = state.dailyWins[dateValue] || createEmptyVictoryDay();

  const todayItems = day.today
    .map((item, index) => ({ ...item, label: `今天 ${index + 1}` }))
    .filter((item) => isFilled(item.text) || isFilled(item.note));
  const tomorrowItems = day.tomorrow
    .map((item, index) => ({ ...item, label: `明天 ${index + 1}` }))
    .filter((item) => isFilled(item.text) || isFilled(item.note));

  list.append(
    createVictoryCard("今天的三個勝利", todayItems, "今天還沒有勝利紀錄。"),
    createVictoryCard("明天的三個勝利", tomorrowItems, "明天還沒有勝利紀錄。")
  );
  block.append(heading, list);
  return block;
}

function createWeeklyVictoryBlock(title, isAllRoles, roleIndex) {
  const block = document.createElement("section");
  block.className = "lookback-panel lookback-victory-wide";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "lookback-victory-list weekly-victory-list";

  getWeekDates().forEach((date, dayIndex) => {
    const items = getVictoryItemsForDate(date).filter((item) => isAllRoles || item.roleIndex === roleIndex);
    list.append(createVictoryCard(`${dayNames[dayIndex]} ${date}`, items, "這天還沒有勝利紀錄。"));
  });

  block.append(heading, list);
  return block;
}

function formatScheduleItem(event) {
  return {
    title: event.title || "未命名行程",
    meta: `${dayNames[event.dayIndex]} ${event.start}-${event.end}｜${getRoleGroupName(event.roleIndex)}`
  };
}

function renderDailyLookback(container) {
  const offset = getDateOffsetInWeek(selectedLookbackDate);
  const dateTitle = `${selectedLookbackDate} ${offset >= 0 && offset < 7 ? dayNames[offset] : ""}`.trim();
  const important = offset >= 0 && offset < 7 ? state.important[offset] : [];
  const schedules = offset >= 0 && offset < 7
    ? state.schedule.filter((event) => event.dayIndex === offset).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))
    : [];

  container.append(
    createHeadlineBlock(dateTitle, "這一天的要事、行程與三個勝利。"),
    createDailyTodoBlock("今日要事", important || [], offset),
    createRichBlock("當日行程", schedules.map(formatScheduleItem)),
    createDailyVictoryBlock(selectedLookbackDate)
  );
}

function renderWeeklyLookback(container) {
  const isAllRoles = selectedLookbackRoleIndex === "all";
  const roleIndex = isAllRoles ? null : Math.min(Number(selectedLookbackRoleIndex) || 0, Math.max(state.roles.length - 1, 0));
  const roleItems = isAllRoles
    ? state.roles.flatMap((role) => role.goals.filter(isFilled).map((goal) => ({ title: goal })))
    : (state.roles[roleIndex]?.goals || []).filter(isFilled).map((goal) => ({ title: goal }));
  const importantItems = getWeekDates().flatMap((date, dayIndex) => (
    state.important[dayIndex]
      .filter((item) => isFilled(item.text))
      .map((item) => ({
        label: `${dayNames[dayIndex]} ${date}｜${item.text}`,
        done: item.done
      }))
  ));
  const reflectionItems = weeklyReviewQuestions.map((question, index) => ({
    title: question,
    body: state.weeklyReviewAnswers[index] || ""
  })).filter((item) => isFilled(item.body));

  container.append(
    createRichBlock("本週目標", roleItems),
    createWeeklyTodoBlock("每週要事", importantItems),
    createWeeklyVictoryBlock("三個勝利", isAllRoles, roleIndex),
    createRichBlock("週反思", reflectionItems)
  );
}

function syncLookbackRoleOptions() {
  const select = document.querySelector("#lookbackRole");
  if (!select) return;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "全部";
  select.append(allOption);
  state.roles.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = getRoleGroupName(index);
    select.append(option);
  });
  select.value = selectedLookbackRoleIndex === "all" ? "all" : String(Math.min(Number(selectedLookbackRoleIndex) || 0, Math.max(state.roles.length - 1, 0)));
}

function setLookbackControlVisible(selector, visible) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.hidden = !visible;
  element.style.display = visible ? "" : "none";
}

function renderLookback() {
  const container = document.querySelector("#lookbackContent");
  if (!container) return;
  container.innerHTML = "";
  document.querySelector("#lookbackDate").value = selectedLookbackDate;
  setLookbackControlVisible("#lookbackDateControl", lookbackMode === "daily");
  setLookbackControlVisible("#prevLookbackDayBtn", lookbackMode === "daily");
  setLookbackControlVisible("#nextLookbackDayBtn", lookbackMode === "daily");
  setLookbackControlVisible("#lookbackRoleControl", lookbackMode === "weekly");
  if (lookbackMode === "weekly") syncLookbackRoleOptions();

  if (lookbackMode === "daily") renderDailyLookback(container);
  if (lookbackMode === "weekly") renderWeeklyLookback(container);
}

function bindLookbackActions() {
  document.querySelectorAll(".lookback-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".lookback-tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      lookbackMode = button.dataset.lookbackMode;
      renderLookback();
    });
  });
  document.querySelector("#lookbackDate").addEventListener("change", (event) => {
    selectedLookbackDate = event.target.value || toDateInputValue(new Date());
    renderLookback();
  });
  document.querySelector("#prevLookbackDayBtn").addEventListener("click", () => {
    selectedLookbackDate = addDaysToDateInput(selectedLookbackDate, -1);
    renderLookback();
  });
  document.querySelector("#nextLookbackDayBtn").addEventListener("click", () => {
    selectedLookbackDate = addDaysToDateInput(selectedLookbackDate, 1);
    renderLookback();
  });
  document.querySelector("#lookbackRole").addEventListener("change", (event) => {
    selectedLookbackRoleIndex = event.target.value === "all" ? "all" : Number(event.target.value) || 0;
    renderLookback();
  });
}

function syncSettingsControls() {
  const reminderTime = document.querySelector("#reminderTime");
  const reminderEnabled = document.querySelector("#reminderEnabled");

  reminderTime.value = state.settings.reminderTime;
  reminderEnabled.checked = state.settings.reminderEnabled;
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

  reminderTime.addEventListener("input", () => {
    state.settings.reminderTime = reminderTime.value;
    saveState();
  });
  reminderEnabled.addEventListener("change", async () => {
    state.settings.reminderEnabled = reminderEnabled.checked;
    if (reminderEnabled.checked) await requestNotificationPermission();
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
  const importantFilled = state.important.flat().filter((item) => item.text.trim()).length;
  const scheduleFilled = state.schedule.length;
  const renewalFilled = Object.values(state.renewal).filter((item) => item.trim()).length;

  document.querySelector("#importantRate").textContent = `${Math.round((importantFilled / (7 * importantSlots)) * 100)}%`;
  document.querySelector("#scheduleCount").textContent = String(scheduleFilled);
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
    notify("現在可以花 3 分鐘更新今日要事、行程與三個勝利。");
    scheduleReminder();
  }, next - now);
}

function bindActions() {
  document.querySelector("#weekStart").value = state.weekStart;
  document.querySelector("#weekStart").addEventListener("change", (event) => {
    switchWeek(event.target.value);
  });

  document.querySelector("#prevWeekBtn").addEventListener("click", () => shiftWeek(-7));
  document.querySelector("#nextWeekBtn").addEventListener("click", () => shiftWeek(7));

  document.querySelector("#addRoleBtn").addEventListener("click", () => {
    state.roles.push({ roles: ["", ""], goals: ["", "", ""], color: roleColors[state.roles.length % roleColors.length] });
    renderRoles();
    renderRoleSettings();
    saveState();
  });

  document.querySelector("#newWeekBtn").addEventListener("click", () => {
    shiftWeek(7);
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
  bindVictoryActions();
  bindLookbackActions();
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

function shiftWeek(days) {
  const start = new Date(`${state.weekStart}T00:00:00`);
  start.setDate(start.getDate() + days);
  switchWeek(toDateInputValue(start));
}

function switchWeek(weekStart) {
  persistStateLocally();
  const carry = {
    roles: state.roles,
    settings: state.settings
  };
  state = loadWeekState(weekStart, carry);
  selectedVictoryDate = weekStart;
  selectedLookbackDate = weekStart;
  renderAll();
  saveState(true);
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
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
  renderRoleSettings();
  renderVictories();
  renderWeeklyReflection();
  renderLookback();
  renderImportantInputs();
  renderSchedule();
  renderRenewal();
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
