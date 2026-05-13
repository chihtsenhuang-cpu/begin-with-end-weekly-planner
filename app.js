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
  { roles: ["個人發展", "身心健全"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[0] },
  { roles: ["基督徒", "神忠實的管家"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[1] },
  { roles: ["財務教練", "受人信任，帶人覺察"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[2] },
  { roles: ["企業家", "打造 AI 賦能高效團隊"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[3] },
  { roles: ["家人", "氣氛和睦感情深厚"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[4] },
  { roles: ["內容創作者", "打造有影響力品牌"], goals: ["", "", ""], goalDone: [false, false, false], color: roleColors[5] }
];

const storageKey = "begin-with-end-week-plan";
const weekStoragePrefix = `${storageKey}:week:`;
const supabaseSettingsKey = "begin-with-end-supabase-settings";
const crmStorageKey = "begin-with-end-crm-workbench";
const crmStages = ["尚未聯絡", "初步聯繫", "財務＆保單分析", "說明與口頭", "建議書", "成交", "轉介紹", "保服", "理賠", "暫緩"];
const crmFunnelStages = ["尚未聯絡", "初步聯繫", "財務＆保單分析", "說明與口頭", "建議書", "成交"];
const crmMethods = ["電話", "LINE", "面訪", "視訊", "Email", "其他"];
const crmLegacyStageHeaders = ["尚未聯絡", "初步聯繫", "財務 (保單) 分析", "說明＆口頭", "建議書", "成交", "轉介紹", "轉介紹成交", "保服", "理賠"];
const crmLegacyColumns = {
  name: "0姓名",
  location: "0.所在地",
  category: "分類",
  birthday: "生日",
  occupation: "職業",
  policies: "已有險種",
  policyStatus: "保單狀態",
  legacyVisitCount: "見面次數",
  pretaxIncome: "税前收入",
  background: "客戶背景",
  nextStep: "行動計劃",
  notes: "備註"
};
let state = loadState();
let crmState = loadCrmState();
let selectedVictoryDate = toDateInputValue(new Date());
let lookbackMode = "daily";
let selectedLookbackDate = toDateInputValue(new Date());
let selectedLookbackRoleIndex = "all";
let selectedCrmAccountId = crmState.accounts[0]?.id || "";
let selectedCrmStageFilter = "all";
let expandedCrmLocations = new Set();
let selectedFunnelYear = new Date().getFullYear();
let selectedFunnelHalf = new Date().getMonth() < 6 ? "H1" : "H2";
let selectedFunnelStage = "all";
let reminderTimer = null;
let deferredInstallPrompt = null;
let supabaseClient = null;
let supabaseSession = null;
let cloudSaveTimer = null;
let crmCloudSaveTimer = null;

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
  const emptyImportantItem = () => ({ text: "", done: false });
  return {
    weekStart: toDateInputValue(startDate),
    roles: structuredClone(defaultRoles),
    important: Array.from({ length: 7 }, () => Array.from({ length: importantSlots }, emptyImportantItem)),
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
  const toGoalText = (value) => {
    if (value && typeof value === "object") return value.text || value.goal || "";
    return value || "";
  };
  const clean = (values) => values.map(toGoalText).filter((value) => value && !roleLabels.has(value));
  if (Array.isArray(item.goals)) {
    return [...clean(item.goals), ...Array(goalSlots).fill("")].slice(0, goalSlots);
  }
  if ("goal" in item) {
    return [...clean([item.goal]), ...Array(goalSlots).fill("")].slice(0, goalSlots);
  }
  return Array(goalSlots).fill("");
}

function normalizeGoalDone(item, goals) {
  const objectDone = Array.isArray(item.goals)
    ? item.goals.map((goal) => Boolean(goal && typeof goal === "object" && goal.done))
    : [];
  const source = Array.isArray(item.goalDone) ? item.goalDone : objectDone;
  return Array.from({ length: goalSlots }, (_, index) => Boolean(source[index]) && isFilled(goals[index]));
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
      return {
        roles: roleLabels,
        goals,
        goalDone: normalizeGoalDone(item, goals),
        color: normalizeHexColor(item.color, roleColors[index % roleColors.length])
      };
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
      migrated.push({
        roles: [firstRole, expectedSecond],
        goals,
        goalDone: normalizeGoalDone(item, goals),
        color: roleColors[migrated.length % roleColors.length]
      });
      return;
    }
    const goals = normalizeGoals(item);
    migrated.push({
      roles: normalizeRoleLabels(item),
      goals,
      goalDone: normalizeGoalDone(item, goals),
      color: roleColors[migrated.length % roleColors.length]
    });
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
    goalDone: Array(goalSlots).fill(false),
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
  renderCrm();
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

function createEmptyCrmState() {
  return {
    accounts: [],
    visits: [],
    importBatches: [],
    updatedAt: new Date().toISOString()
  };
}

function loadCrmState() {
  try {
    return normalizeCrmState(JSON.parse(localStorage.getItem(crmStorageKey) || "{}"));
  } catch {
    return createEmptyCrmState();
  }
}

function normalizeCrmState(data = {}) {
  const base = createEmptyCrmState();
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const visits = Array.isArray(data.visits) ? data.visits : [];
  const importBatches = Array.isArray(data.importBatches) ? data.importBatches : [];
  return {
    ...base,
    ...data,
    accounts: accounts.map(normalizeCrmAccount).filter((account) => isFilled(account.name)),
    visits: visits.map(normalizeCrmVisit).filter((visit) => isFilled(visit.accountId)),
    importBatches
  };
}

function normalizeCrmStage(stage) {
  const map = {
    財務分析: "財務＆保單分析",
    "財務 (保單) 分析": "財務＆保單分析",
    "說明＆口頭": "說明與口頭",
    轉介紹成交: "成交"
  };
  return map[stage] || stage;
}

function normalizeCrmAccount(account) {
  const stage = normalizeCrmStage(account?.stage);
  return {
    id: account?.id || crypto.randomUUID(),
    sourceKey: account?.sourceKey || "",
    name: account?.name || "",
    stage: crmStages.includes(stage) ? stage : "尚未聯絡",
    location: account?.location || "",
    category: account?.category || "",
    birthday: account?.birthday || "",
    occupation: account?.occupation || "",
    pretaxIncome: account?.pretaxIncome || "",
    policies: account?.policies || "",
    products: Array.isArray(account?.products) ? account.products.filter(isFilled) : splitPolicyProducts(account?.policies || ""),
    policyStatus: account?.policyStatus || "",
    background: account?.background || "",
    nextStep: account?.nextStep || "",
    nextFollowUpDate: account?.nextFollowUpDate || "",
    notes: account?.notes || "",
    legacyVisitCount: isFilled(account?.legacyVisitCount) && Number.isFinite(Number(account.legacyVisitCount)) ? Number(account.legacyVisitCount) : null,
    sourceRaw: account?.sourceRaw || {},
    lastContactDate: account?.lastContactDate || "",
    createdAt: account?.createdAt || new Date().toISOString(),
    updatedAt: account?.updatedAt || new Date().toISOString()
  };
}

function normalizeCrmVisit(visit) {
  const stageAfter = normalizeCrmStage(visit?.stageAfter);
  return {
    id: visit?.id || crypto.randomUUID(),
    accountId: visit?.accountId || "",
    date: visit?.date || toDateInputValue(new Date()),
    method: crmMethods.includes(visit?.method) ? visit.method : "面訪",
    summary: visit?.summary || "",
    result: visit?.result || "",
    nextStep: visit?.nextStep || "",
    nextFollowUpDate: visit?.nextFollowUpDate || "",
    pretaxIncome: visit?.pretaxIncome || "",
    stageAfter: crmStages.includes(stageAfter) ? stageAfter : "",
    createdAt: visit?.createdAt || new Date().toISOString()
  };
}

function saveCrmState() {
  crmState.updatedAt = new Date().toISOString();
  localStorage.setItem(crmStorageKey, JSON.stringify(crmState));
  renderCrm();
  renderFunnel();
  queueCrmCloudSave();
}

function getCrmAccount(accountId = selectedCrmAccountId) {
  return crmState.accounts.find((account) => account.id === accountId) || null;
}

function getCrmVisits(accountId) {
  return crmState.visits
    .filter((visit) => visit.accountId === accountId)
    .sort((a, b) => `${b.date} ${b.createdAt}`.localeCompare(`${a.date} ${a.createdAt}`));
}

function getCrmAccountLatestVisit(accountId) {
  return getCrmVisits(accountId)[0] || null;
}

function getCrmFaceToFaceVisitCount(accountId) {
  return crmState.visits.filter((visit) => visit.accountId === accountId && visit.method === "面訪").length;
}

function getCrmMeetingCount(account) {
  const importedCount = Number.isFinite(account?.legacyVisitCount) ? account.legacyVisitCount : 0;
  return importedCount + getCrmFaceToFaceVisitCount(account.id);
}

function parseCrmMoney(value) {
  const normalized = String(value || "")
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatCrmMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "0";
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(number);
}

function getCrmVisitPretaxIncomeSum(accountId) {
  return crmState.visits
    .filter((visit) => visit.accountId === accountId)
    .reduce((sum, visit) => sum + parseCrmMoney(visit.pretaxIncome), 0);
}

function getCrmPretaxIncomeTotal(account) {
  return parseCrmMoney(account?.pretaxIncome) + getCrmVisitPretaxIncomeSum(account.id);
}

function getCrmMeetingEfficiency(account) {
  const meetingCount = getCrmMeetingCount(account);
  if (!meetingCount) return 0;
  return getCrmPretaxIncomeTotal(account) / meetingCount;
}

function getCrmAccountImportedStage(account) {
  if (!account?.sourceRaw) return "";
  return getLegacyActiveStage(account.sourceRaw);
}

function applyLatestVisitToCrmAccount(account, fallbackStage = "") {
  const latest = getCrmAccountLatestVisit(account.id);
  if (latest) {
    account.stage = latest.stageAfter || account.stage;
    account.nextStep = latest.nextStep;
    account.nextFollowUpDate = latest.nextFollowUpDate;
    account.lastContactDate = latest.date;
  } else {
    account.stage = fallbackStage || getCrmAccountImportedStage(account) || "尚未聯絡";
    account.nextStep = "";
    account.nextFollowUpDate = "";
    account.lastContactDate = "";
  }
  account.updatedAt = new Date().toISOString();
}

function isCrmFollowUpDue(account) {
  if (!account.nextFollowUpDate) return isFilled(account.nextStep);
  return account.nextFollowUpDate <= toDateInputValue(new Date());
}

function getRecentCrmVisits() {
  const today = new Date(`${toDateInputValue(new Date())}T00:00:00`);
  const since = new Date(today);
  since.setDate(today.getDate() - 30);
  const sinceValue = toDateInputValue(since);
  return crmState.visits.filter((visit) => visit.date >= sinceValue);
}

function getFunnelRange() {
  return selectedFunnelHalf === "H1"
    ? { start: `${selectedFunnelYear}-01-01`, end: `${selectedFunnelYear}-06-30`, label: `${selectedFunnelYear} 上半年` }
    : { start: `${selectedFunnelYear}-07-01`, end: `${selectedFunnelYear}-12-31`, label: `${selectedFunnelYear} 下半年` };
}

function toDateValueFromIso(value) {
  return String(value || "").slice(0, 10);
}

function getAccountFunnelDate(account) {
  return account.lastContactDate || toDateValueFromIso(account.updatedAt) || toDateValueFromIso(account.createdAt);
}

function isDateInFunnelRange(dateValue) {
  if (!dateValue) return false;
  const range = getFunnelRange();
  return dateValue >= range.start && dateValue <= range.end;
}

function getFunnelAccounts() {
  const accounts = new Map();
  getFunnelEvents().forEach((event) => {
    if (event.account) accounts.set(event.account.id, event.account);
  });
  return [...accounts.values()];
}

function getLegacyFunnelStages(account) {
  const stages = crmLegacyStageHeaders
    .filter((stage) => isLegacyChecked(account.sourceRaw?.[stage]))
    .map(normalizeLegacyStage)
    .filter((stage) => crmFunnelStages.includes(stage));
  const unique = [...new Set(stages)];
  if (unique.length) return unique;
  return crmFunnelStages.includes(account.stage) ? [account.stage] : [];
}

function getFunnelEvents() {
  const events = [];
  const accountsWithVisits = new Set();
  crmState.visits.forEach((visit) => {
    accountsWithVisits.add(visit.accountId);
    if (!crmFunnelStages.includes(visit.stageAfter) || !isDateInFunnelRange(visit.date)) return;
    const account = getCrmAccount(visit.accountId);
    if (!account) return;
    events.push({
      id: visit.id,
      account,
      visit,
      stage: visit.stageAfter,
      date: visit.date,
      label: visit.method,
      source: "visit"
    });
  });

  crmState.accounts.forEach((account) => {
    if (accountsWithVisits.has(account.id) || !isDateInFunnelRange(getAccountFunnelDate(account))) return;
    getLegacyFunnelStages(account).forEach((stage) => {
      events.push({
        id: `${account.id}:${stage}`,
        account,
        visit: null,
        stage,
        date: getAccountFunnelDate(account),
        label: "匯入資料",
        source: "legacy"
      });
    });
  });

  return events.sort((a, b) => (
    b.date.localeCompare(a.date) ||
    crmFunnelStages.indexOf(a.stage) - crmFunnelStages.indexOf(b.stage) ||
    a.account.name.localeCompare(b.account.name, "zh-Hant", { numeric: true, sensitivity: "base" })
  ));
}

function getFunnelSummary() {
  const events = getFunnelEvents();
  const accounts = [...new Map(events.map((event) => [event.account.id, event.account])).values()];
  const byStage = Object.fromEntries(crmFunnelStages.map((stage) => [stage, []]));
  events.forEach((event) => {
    byStage[event.stage].push(event);
  });
  return { accounts, events, byStage };
}

function splitPolicyProducts(policies) {
  return String(policies || "")
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeImportHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseDelimitedTable(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length);
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function normalizeImportDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(/\//g, "-");
  const parts = normalized.split("-").map((part) => part.padStart(2, "0"));
  if (parts.length === 3 && /^\d{4}$/.test(parts[0])) return `${parts[0]}-${parts[1]}-${parts[2]}`;
  return "";
}

function isLegacyChecked(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "v", "x", "是", "✓", "✔"].includes(normalized);
}

function normalizeLegacyStage(stage) {
  return normalizeCrmStage(stage);
}

function getLegacyActiveStage(raw) {
  const checked = crmLegacyStageHeaders.filter((stage) => isLegacyChecked(raw[stage]));
  return normalizeLegacyStage(checked.at(-1) || "尚未聯絡");
}

function createLegacySourceKey(raw) {
  return [raw[crmLegacyColumns.name], raw[crmLegacyColumns.birthday], raw[crmLegacyColumns.location]]
    .map((value) => String(value || "").trim())
    .join("|");
}

function legacyRowToCrmAccount(headers, row) {
  const raw = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
  const policies = raw[crmLegacyColumns.policies] || "";
  return normalizeCrmAccount({
    sourceKey: createLegacySourceKey(raw),
    name: raw[crmLegacyColumns.name] || "",
    stage: getLegacyActiveStage(raw),
    location: raw[crmLegacyColumns.location] || "",
    category: raw[crmLegacyColumns.category] || "",
    birthday: normalizeImportDate(raw[crmLegacyColumns.birthday]),
    occupation: raw[crmLegacyColumns.occupation] || "",
    pretaxIncome: raw[crmLegacyColumns.pretaxIncome] || "",
    policies,
    products: splitPolicyProducts(policies),
    policyStatus: raw[crmLegacyColumns.policyStatus] || "",
    background: raw[crmLegacyColumns.background] || "",
    nextStep: raw[crmLegacyColumns.nextStep] || "",
    notes: raw[crmLegacyColumns.notes] || "",
    legacyVisitCount: raw[crmLegacyColumns.legacyVisitCount] || null,
    sourceRaw: raw
  });
}

function importLegacyCrmRows(text, source = {}) {
  const rows = parseDelimitedTable(text);
  if (rows.length < 2) return { imported: 0, skipped: 0, reason: "資料不足，至少要有表頭和一列資料。" };
  const headers = rows[0].map(normalizeImportHeader);
  if (!headers.includes(crmLegacyColumns.name)) {
    return { imported: 0, skipped: rows.length - 1, reason: "找不到表頭「0姓名」，請確認匯入的是客戶紀錄原始表。" };
  }

  const batch = {
    id: crypto.randomUUID(),
    sourceType: source.sourceType || "csv",
    sourceName: source.sourceName || "客戶紀錄",
    sourceUrl: source.sourceUrl || "",
    sheetName: source.sheetName || "",
    rowCount: rows.length - 1,
    status: "imported",
    importedAt: new Date().toISOString(),
    rows: []
  };
  const byKey = new Map(crmState.accounts.map((account) => [account.sourceKey || account.id, account]));
  let imported = 0;
  let skipped = 0;

  rows.slice(1).forEach((row, index) => {
    const account = legacyRowToCrmAccount(headers, row);
    const rowRecord = {
      id: crypto.randomUUID(),
      rowNumber: index + 2,
      accountId: account.id,
      rawData: account.sourceRaw,
      importStatus: "imported",
      errorMessage: ""
    };
    if (!isFilled(account.name)) {
      skipped += 1;
      rowRecord.accountId = "";
      rowRecord.importStatus = "skipped";
      rowRecord.errorMessage = "姓名空白";
      batch.rows.push(rowRecord);
      return;
    }
    const existing = byKey.get(account.sourceKey);
    if (existing) account.id = existing.id;
    byKey.set(account.sourceKey, account);
    rowRecord.accountId = account.id;
    batch.rows.push(rowRecord);
    imported += 1;
  });

  crmState.accounts = [...byKey.values()];
  crmState.importBatches.push(batch);
  saveCrmState();
  selectedCrmAccountId = crmState.accounts[0]?.id || "";
  return { imported, skipped, batch };
}

function setCrmImportStatus(message) {
  const status = document.querySelector("#crmImportStatus");
  if (status) status.textContent = message;
}

function getFilteredCrmAccounts() {
  const search = document.querySelector("#crmSearch")?.value.trim().toLowerCase() || "";
  return crmState.accounts
    .filter((account) => selectedCrmStageFilter === "all" || account.stage === selectedCrmStageFilter)
    .filter((account) => {
      if (!search) return true;
      return [account.name, account.location, account.category, account.occupation, account.policyStatus, account.background, account.nextStep, account.notes]
        .some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((a, b) => Number(isCrmFollowUpDue(b)) - Number(isCrmFollowUpDue(a)) || a.name.localeCompare(b.name, "zh-Hant"));
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
    loadCrmFromCloud().then(() => queueCrmCloudSave());
  });
  updateSupabaseStatus();
  await loadCrmFromCloud();
  queueCrmCloudSave();
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

function queueCrmCloudSave() {
  if (!supabaseClient || !supabaseSession?.user) return;
  if (crmCloudSaveTimer) clearTimeout(crmCloudSaveTimer);
  crmCloudSaveTimer = setTimeout(() => {
    saveCrmToCloud();
  }, 900);
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

function mapCrmAccountToCloud(account) {
  return {
    id: account.id,
    user_id: supabaseSession.user.id,
    source_key: account.sourceKey || null,
    name: account.name,
    current_stage: account.stage,
    location: account.location || null,
    category: account.category || null,
    birthday: account.birthday || null,
    occupation: account.occupation || null,
    pretax_income: account.pretaxIncome || null,
    policies: account.policies || null,
    policy_status: account.policyStatus || null,
    background: account.background || null,
    next_step: account.nextStep || null,
    next_follow_up_date: account.nextFollowUpDate || null,
    notes: account.notes || null,
    legacy_visit_count: Number.isFinite(account.legacyVisitCount) ? account.legacyVisitCount : null,
    source_raw: account.sourceRaw || {},
    last_contact_date: account.lastContactDate || null,
    created_at: account.createdAt,
    updated_at: account.updatedAt
  };
}

function mapCrmVisitToCloud(visit) {
  return {
    id: visit.id,
    user_id: supabaseSession.user.id,
    account_id: visit.accountId,
    contact_date: visit.date,
    method: visit.method,
    summary: visit.summary || null,
    result: visit.result || null,
    next_step: visit.nextStep || null,
    next_follow_up_date: visit.nextFollowUpDate || null,
    pretax_income: visit.pretaxIncome || null,
    stage_after: visit.stageAfter || null,
    created_at: visit.createdAt,
    updated_at: new Date().toISOString()
  };
}

async function saveCrmToCloud(showStatus = false) {
  if (!supabaseClient || !supabaseSession?.user) return false;
  const warnings = [];

  const accounts = crmState.accounts.map(mapCrmAccountToCloud);
  if (accounts.length) {
    const { error } = await supabaseClient.from("crm_accounts").upsert(accounts, { onConflict: "id" });
    if (error) {
      setSupabaseStatus(`CRM 同步失敗：${error.message}`);
      return false;
    }
  }

  const productRows = crmState.accounts.flatMap((account) => (
    (account.products || splitPolicyProducts(account.policies)).map((product) => ({
      user_id: supabaseSession.user.id,
      account_id: account.id,
      product_type: product,
      note: null
    }))
  ));
  if (productRows.length) {
    const { error } = await supabaseClient
      .from("crm_account_products")
      .upsert(productRows, { onConflict: "user_id,account_id,product_type" });
    if (error) {
      setSupabaseStatus(`CRM 險種同步失敗：${error.message}`);
      return false;
    }
  }

  const visits = crmState.visits.map(mapCrmVisitToCloud);
  if (visits.length) {
    const { error } = await supabaseClient.from("crm_visit_records").upsert(visits, { onConflict: "id" });
    if (error) {
      setSupabaseStatus(`CRM 拜訪紀錄同步失敗：${error.message}`);
      return false;
    }
  }

  const batches = crmState.importBatches || [];
  if (batches.length) {
    const batchRows = batches.map((batch) => ({
      id: batch.id,
      user_id: supabaseSession.user.id,
      source_type: batch.sourceType,
      source_name: batch.sourceName || null,
      source_url: batch.sourceUrl || null,
      sheet_name: batch.sheetName || null,
      row_count: batch.rowCount || 0,
      status: batch.status || "imported",
      imported_at: batch.importedAt
    }));
    const { error: batchError } = await supabaseClient.from("crm_import_batches").upsert(batchRows, { onConflict: "id" });
    if (batchError) {
      setSupabaseStatus(`CRM 匯入批次同步失敗：${batchError.message}`);
      return false;
    }

    const importRows = batches.flatMap((batch) => (batch.rows || []).map((row) => ({
      id: row.id,
      user_id: supabaseSession.user.id,
      batch_id: batch.id,
      row_number: row.rowNumber,
      account_id: row.accountId || null,
      raw_data: row.rawData || {},
      import_status: row.importStatus || "imported",
      error_message: row.errorMessage || null
    })));
    if (importRows.length) {
      const { error: rowError } = await supabaseClient.from("crm_import_rows").upsert(importRows, { onConflict: "id" });
      if (rowError) {
        warnings.push(`匯入原始列未同步：${rowError.message}`);
      }
    }
  }

  if (showStatus) {
    const warningText = warnings.length ? `；${warnings.join("；")}` : "";
    updateSupabaseStatus(`CRM 已同步到 Supabase：${crmState.accounts.length} 位客戶、${crmState.visits.length} 筆拜訪${warningText}`);
  }
  return true;
}

function cloudAccountToLocal(row, productsByAccount = new Map()) {
  const products = productsByAccount.get(row.id) || splitPolicyProducts(row.policies || "");
  return normalizeCrmAccount({
    id: row.id,
    sourceKey: row.source_key || "",
    name: row.name || "",
    stage: row.current_stage || "尚未聯絡",
    location: row.location || "",
    category: row.category || "",
    birthday: row.birthday || "",
    occupation: row.occupation || "",
    pretaxIncome: row.pretax_income || "",
    policies: row.policies || products.join(", "),
    products,
    policyStatus: row.policy_status || "",
    background: row.background || "",
    nextStep: row.next_step || "",
    nextFollowUpDate: row.next_follow_up_date || "",
    notes: row.notes || "",
    legacyVisitCount: row.legacy_visit_count,
    sourceRaw: row.source_raw || {},
    lastContactDate: row.last_contact_date || "",
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  });
}

function cloudVisitToLocal(row) {
  return normalizeCrmVisit({
    id: row.id,
    accountId: row.account_id,
    date: row.contact_date,
    method: row.method,
    summary: row.summary || "",
    result: row.result || "",
    nextStep: row.next_step || "",
    nextFollowUpDate: row.next_follow_up_date || "",
    pretaxIncome: row.pretax_income || "",
    stageAfter: row.stage_after || "",
    createdAt: row.created_at || new Date().toISOString()
  });
}

async function loadCrmFromCloud() {
  if (!supabaseClient || !supabaseSession?.user) return false;
  const { data: accounts, error: accountError } = await supabaseClient
    .from("crm_accounts")
    .select("*")
    .eq("user_id", supabaseSession.user.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (accountError) {
    setSupabaseStatus(`CRM 載入失敗：${accountError.message}`);
    return false;
  }

  const { data: products, error: productError } = await supabaseClient
    .from("crm_account_products")
    .select("*")
    .eq("user_id", supabaseSession.user.id);
  if (productError) {
    setSupabaseStatus(`CRM 險種載入失敗：${productError.message}`);
    return false;
  }

  const { data: visits, error: visitError } = await supabaseClient
    .from("crm_visit_records")
    .select("*")
    .eq("user_id", supabaseSession.user.id)
    .order("contact_date", { ascending: false });
  if (visitError) {
    setSupabaseStatus(`CRM 拜訪紀錄載入失敗：${visitError.message}`);
    return false;
  }

  if (!accounts?.length && !visits?.length) return true;

  const productsByAccount = new Map();
  (products || []).forEach((product) => {
    const list = productsByAccount.get(product.account_id) || [];
    list.push(product.product_type);
    productsByAccount.set(product.account_id, list);
  });
  const localAccounts = new Map(crmState.accounts.map((account) => [account.id, account]));
  accounts.forEach((row) => {
    localAccounts.set(row.id, cloudAccountToLocal(row, productsByAccount));
  });
  const localVisits = new Map(crmState.visits.map((visit) => [visit.id, visit]));
  visits.forEach((row) => {
    localVisits.set(row.id, cloudVisitToLocal(row));
  });

  crmState.accounts = [...localAccounts.values()];
  crmState.visits = [...localVisits.values()];
  crmState.updatedAt = new Date().toISOString();
  localStorage.setItem(crmStorageKey, JSON.stringify(crmState));
  if (!getCrmAccount()) selectedCrmAccountId = crmState.accounts[0]?.id || "";
  renderCrm();
  renderFunnel();
  return true;
}

async function deleteCrmAccountFromCloud(accountId) {
  if (!supabaseClient || !supabaseSession?.user || !accountId) return;
  await supabaseClient
    .from("crm_accounts")
    .delete()
    .eq("user_id", supabaseSession.user.id)
    .eq("id", accountId);
}

async function deleteCrmVisitFromCloud(visitId) {
  if (!supabaseClient || !supabaseSession?.user || !visitId) return;
  await supabaseClient
    .from("crm_visit_records")
    .delete()
    .eq("user_id", supabaseSession.user.id)
    .eq("id", visitId);
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
      if (button.dataset.view === "crm") renderCrm();
      if (button.dataset.view === "funnel") renderFunnel();
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

function renderCrmStageOptions(select, includeAll = false) {
  if (!select) return;
  select.innerHTML = "";
  if (includeAll) {
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "全部階段";
    select.append(all);
  }
  crmStages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage;
    option.textContent = stage;
    select.append(option);
  });
}

function renderCrmStats() {
  const accountCount = document.querySelector("#crmAccountCount");
  if (!accountCount) return;
  accountCount.textContent = String(crmState.accounts.length);
  document.querySelector("#crmFollowUpCount").textContent = String(crmState.accounts.filter(isCrmFollowUpDue).length);
  document.querySelector("#crmRecentVisitCount").textContent = String(getRecentCrmVisits().length);
  document.querySelector("#crmVisitCount").textContent = String(crmState.visits.length);
}

function createCrmMeta(account) {
  return [account.location, account.category, account.occupation, account.policyStatus]
    .filter(isFilled)
    .join("｜") || "尚未補齊基本資料";
}

function compareCrmLocation(a, b) {
  const left = isFilled(a) ? a : "zzzzzz";
  const right = isFilled(b) ? b : "zzzzzz";
  return left.localeCompare(right, "zh-Hant", { numeric: true, sensitivity: "base" });
}

function groupCrmAccountsByLocation(accounts) {
  const groups = new Map();
  accounts.forEach((account) => {
    const key = isFilled(account.location) ? account.location : "未填所在地";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(account);
  });
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === "未填所在地") return 1;
      if (b === "未填所在地") return -1;
      return compareCrmLocation(a, b);
    })
    .map(([location, items]) => ({
      location,
      accounts: items.sort((a, b) => {
        const followUpPriority = Number(isCrmFollowUpDue(b)) - Number(isCrmFollowUpDue(a));
        if (followUpPriority) return followUpPriority;
        const dateA = a.nextFollowUpDate || "9999-12-31";
        const dateB = b.nextFollowUpDate || "9999-12-31";
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.name.localeCompare(b.name, "zh-Hant", { numeric: true, sensitivity: "base" });
      })
    }));
}

function createCrmAccountCard(account) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = account.id === selectedCrmAccountId ? "crm-account-card active" : "crm-account-card";
  const latest = getCrmAccountLatestVisit(account.id);
  const followUp = account.nextFollowUpDate ? `追蹤 ${account.nextFollowUpDate}` : "未排追蹤";
  button.innerHTML = `
    <span class="crm-account-card-top">
      <strong></strong>
      <em>${account.stage}</em>
    </span>
    <span class="crm-account-meta"></span>
    <span class="crm-account-foot">${followUp}${latest ? `｜最近 ${latest.date}` : ""}</span>
  `;
  button.querySelector("strong").textContent = account.name;
  button.querySelector(".crm-account-meta").textContent = createCrmMeta(account);
  if (isCrmFollowUpDue(account)) button.classList.add("due");
  button.addEventListener("click", () => {
    selectedCrmAccountId = account.id;
    renderCrm();
  });
  return button;
}

function renderCrmAccountList() {
  const list = document.querySelector("#crmAccountList");
  if (!list) return;
  list.innerHTML = "";

  const accounts = getFilteredCrmAccounts();
  if (!accounts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state crm-empty";
    empty.textContent = crmState.accounts.length ? "沒有符合條件的客戶。" : "目前還沒有客戶，先新增第一位客戶。";
    list.append(empty);
    return;
  }

  if (!getCrmAccount() || !accounts.some((account) => account.id === selectedCrmAccountId)) {
    selectedCrmAccountId = accounts[0].id;
  }

  groupCrmAccountsByLocation(accounts).forEach((group) => {
    const details = document.createElement("details");
    details.className = "crm-location-group";
    details.open = expandedCrmLocations.has(group.location);
    details.addEventListener("toggle", () => {
      if (details.open) expandedCrmLocations.add(group.location);
      else expandedCrmLocations.delete(group.location);
    });

    const summary = document.createElement("summary");
    summary.className = "crm-location-summary";
    const title = document.createElement("span");
    title.textContent = group.location;
    const count = document.createElement("strong");
    count.textContent = `${group.accounts.length} 位`;
    const arrow = document.createElement("i");
    arrow.textContent = "›";
    summary.append(title, count, arrow);

    const content = document.createElement("div");
    content.className = "crm-location-content";
    group.accounts.forEach((account) => content.append(createCrmAccountCard(account)));
    details.append(summary, content);
    list.append(details);
  });
}

function createCrmInfoItem(label, value) {
  const item = document.createElement("p");
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = isFilled(value) ? value : "未填寫";
  item.append(name, content);
  return item;
}

function renderCrmVisitTimeline(account) {
  const timeline = document.createElement("div");
  timeline.className = "crm-timeline";
  const visits = getCrmVisits(account.id);
  if (!visits.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "還沒有拜訪紀錄。";
    timeline.append(empty);
    return timeline;
  }

  visits.forEach((visit) => {
    const item = document.createElement("article");
    item.className = "crm-visit-item";
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = `${visit.date}｜${visit.method}${visit.stageAfter ? `｜${visit.stageAfter}` : ""}`;
    const actions = document.createElement("div");
    actions.className = "button-row compact-row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost-button compact-button";
    edit.textContent = "編輯";
    edit.addEventListener("click", () => renderCrmDetail(visit.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button compact-button";
    remove.textContent = "刪除";
    remove.addEventListener("click", () => deleteCrmVisit(account.id, visit.id));
    actions.append(edit, remove);
    header.append(title, actions);
    item.append(header);
    [
      ["內容", visit.summary],
      ["結果", visit.result],
      ["下一步", visit.nextStep],
      ["下次追蹤", visit.nextFollowUpDate],
      ["稅前收入", visit.pretaxIncome ? formatCrmMoney(parseCrmMoney(visit.pretaxIncome)) : ""]
    ].forEach(([label, value]) => {
      if (!isFilled(value)) return;
      const line = document.createElement("p");
      line.textContent = `${label}：${value}`;
      item.append(line);
    });
    timeline.append(item);
  });
  return timeline;
}

function renderCrmVisitForm(account, editingVisitId = "") {
  const editingVisit = editingVisitId ? crmState.visits.find((visit) => visit.id === editingVisitId) : null;
  const form = document.createElement("form");
  form.className = "crm-visit-form";
  form.innerHTML = `
    <input name="visitId" type="hidden">
    <div class="crm-form-grid">
      <label class="field-row">
        <span>拜訪日期</span>
        <input name="date" type="date" required>
      </label>
      <label class="field-row">
        <span>方式</span>
        <select name="method"></select>
      </label>
      <label class="field-row">
        <span>更新階段</span>
        <select name="stageAfter"></select>
      </label>
      <label class="field-row">
        <span>稅前收入</span>
        <input name="pretaxIncome" type="text" inputmode="decimal" placeholder="成交佣金">
      </label>
      <label class="field-row">
        <span>下次追蹤</span>
        <input name="nextFollowUpDate" type="date">
      </label>
    </div>
    <label class="field-row">
      <span>這次談了什麼</span>
      <textarea name="summary" rows="3" placeholder="記錄重點、需求、顧慮"></textarea>
    </label>
    <label class="field-row">
      <span>客戶反應 / 結果</span>
      <textarea name="result" rows="2" placeholder="這次互動後的判斷"></textarea>
    </label>
    <label class="field-row">
      <span>下一步</span>
      <input name="nextStep" type="text" placeholder="例如：補資料、約下次說明、送建議書">
    </label>
    <div class="button-row compact-row">
      <button type="submit" class="primary-button">${editingVisit ? "儲存拜訪紀錄" : "新增拜訪紀錄"}</button>
      <button name="cancelEdit" type="button" class="ghost-button" ${editingVisit ? "" : "hidden"}>取消編輯</button>
    </div>
  `;
  form.elements.visitId.value = editingVisit?.id || "";
  form.elements.date.value = editingVisit?.date || toDateInputValue(new Date());
  crmMethods.forEach((method) => {
    const option = document.createElement("option");
    option.value = method;
    option.textContent = method;
    form.elements.method.append(option);
  });
  renderCrmStageOptions(form.elements.stageAfter);
  form.elements.method.value = editingVisit?.method || "面訪";
  form.elements.stageAfter.value = editingVisit?.stageAfter || account.stage;
  form.elements.summary.value = editingVisit?.summary || "";
  form.elements.result.value = editingVisit?.result || "";
  form.elements.nextStep.value = editingVisit?.nextStep || account.nextStep || "";
  form.elements.nextFollowUpDate.value = editingVisit?.nextFollowUpDate || account.nextFollowUpDate || "";
  form.elements.pretaxIncome.value = editingVisit?.pretaxIncome || "";
  form.elements.cancelEdit.addEventListener("click", () => renderCrmDetail());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCrmVisit(account.id, new FormData(form));
    form.reset();
  });
  return form;
}

function renderCrmDetail(editingVisitId = "") {
  const detail = document.querySelector("#crmDetail");
  if (!detail) return;
  detail.innerHTML = "";
  const account = getCrmAccount();
  if (!account) {
    const empty = document.createElement("div");
    empty.className = "crm-detail-empty";
    empty.innerHTML = "<h3>選擇或新增一位客戶</h3><p>客戶詳情、拜訪紀錄與下一步會顯示在這裡。</p>";
    detail.append(empty);
    return;
  }

  const header = document.createElement("header");
  header.className = "crm-detail-header";
  const title = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = account.name;
  const meta = document.createElement("p");
  meta.textContent = createCrmMeta(account);
  title.append(name, meta);
  const actions = document.createElement("div");
  actions.className = "button-row compact-row";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "ghost-button";
  edit.textContent = "編輯客戶";
  edit.addEventListener("click", () => openCrmAccountEditor(account.id));
  actions.append(edit);
  header.append(title, actions);

  const status = document.createElement("div");
  status.className = "crm-status-strip";
  status.append(
    createCrmInfoItem("目前階段", account.stage),
    createCrmInfoItem("下一步", account.nextStep),
    createCrmInfoItem("下次追蹤", account.nextFollowUpDate),
    createCrmInfoItem("最近接觸", account.lastContactDate),
    createCrmInfoItem("面談效益", getCrmMeetingCount(account) ? formatCrmMoney(getCrmMeetingEfficiency(account)) : "")
  );

  const profile = document.createElement("section");
  profile.className = "crm-profile-grid";
  profile.append(
    createCrmInfoItem("所在地", account.location),
    createCrmInfoItem("分類", account.category),
    createCrmInfoItem("生日", account.birthday),
    createCrmInfoItem("職業", account.occupation),
    createCrmInfoItem("已有險種", account.policies),
    createCrmInfoItem("保單狀態", account.policyStatus),
    createCrmInfoItem("客戶背景", account.background),
    createCrmInfoItem("備註", account.notes),
    createCrmInfoItem("稅前收入", formatCrmMoney(getCrmPretaxIncomeTotal(account))),
    createCrmInfoItem("見面次數", `${getCrmMeetingCount(account)} 次`)
  );

  const visitBlock = document.createElement("section");
  visitBlock.className = "crm-section";
  const visitTitle = document.createElement("h3");
  visitTitle.textContent = "新增拜訪紀錄";
  visitTitle.textContent = editingVisitId ? "編輯拜訪紀錄" : "新增拜訪紀錄";
  visitBlock.append(visitTitle, renderCrmVisitForm(account, editingVisitId));

  const timelineBlock = document.createElement("section");
  timelineBlock.className = "crm-section";
  const timelineTitle = document.createElement("h3");
  timelineTitle.textContent = "歷史拜訪";
  timelineBlock.append(timelineTitle, renderCrmVisitTimeline(account));

  detail.append(header, status, profile, visitBlock, timelineBlock);
}

function renderCrm() {
  if (!document.querySelector("#crmAccountList")) return;
  renderCrmStats();
  renderCrmStageOptions(document.querySelector("#crmStageFilter"), true);
  document.querySelector("#crmStageFilter").value = selectedCrmStageFilter;
  renderCrmAccountList();
  renderCrmDetail();
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function renderFunnel() {
  const stageList = document.querySelector("#funnelStageList");
  if (!stageList) return;
  document.querySelector("#funnelYear").value = selectedFunnelYear;
  document.querySelector("#funnelHalf").value = selectedFunnelHalf;

  const { events, byStage } = getFunnelSummary();
  const total = events.length;
  const closed = byStage["成交"]?.length || 0;
  const contacted = byStage["初步聯繫"]?.length || 0;
  const largest = crmFunnelStages
    .map((stage) => ({ stage, count: byStage[stage]?.length || 0 }))
    .filter((item) => item.stage !== "成交")
    .sort((a, b) => b.count - a.count)[0];

  document.querySelector("#funnelTotalCount").textContent = String(total);
  document.querySelector("#funnelClosedCount").textContent = String(closed);
  document.querySelector("#funnelCloseRate").textContent = contacted ? formatPercent(closed / contacted) : "0%";
  document.querySelector("#funnelLargestStage").textContent = largest?.count ? largest.stage : "-";

  const max = Math.max(...crmFunnelStages.map((stage) => byStage[stage]?.length || 0), 1);
  stageList.innerHTML = "";
  crmFunnelStages.forEach((stage) => {
    const count = byStage[stage]?.length || 0;
    const ratio = total ? count / total : 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = selectedFunnelStage === stage ? "funnel-stage active" : "funnel-stage";
    button.innerHTML = `
      <span class="funnel-stage-head">
        <strong>${stage}</strong>
        <em>${count} 次</em>
      </span>
      <span class="funnel-bar"><i style="width: ${Math.max((count / max) * 100, count ? 8 : 0)}%"></i></span>
      <span class="funnel-stage-meta">${getFunnelRange().label}｜實際紀錄 ${formatPercent(ratio)}</span>
    `;
    button.addEventListener("click", () => {
      selectedFunnelStage = selectedFunnelStage === stage ? "all" : stage;
      renderFunnel();
    });
    stageList.append(button);
  });

  renderFunnelAccounts(byStage);
}

function renderFunnelAccounts(byStage = getFunnelSummary().byStage) {
  const list = document.querySelector("#funnelAccountList");
  if (!list) return;
  const title = document.querySelector("#funnelAccountTitle");
  const events = selectedFunnelStage === "all"
    ? getFunnelSummary().events
    : (byStage[selectedFunnelStage] || []);
  title.textContent = selectedFunnelStage === "all" ? "全部漏斗紀錄" : `「${selectedFunnelStage}」紀錄`;

  list.innerHTML = "";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state crm-empty";
    empty.textContent = "這個區間沒有符合條件的客戶。";
    list.append(empty);
    return;
  }

  events
    .slice()
    .sort((a, b) => (
      b.date.localeCompare(a.date) ||
      crmFunnelStages.indexOf(a.stage) - crmFunnelStages.indexOf(b.stage) ||
      a.account.name.localeCompare(b.account.name, "zh-Hant", { numeric: true })
    ))
    .forEach((event) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "funnel-account-card";
      const account = event.account;
      const summary = event.visit?.summary || event.visit?.result || createCrmMeta(account);
      card.innerHTML = `
        <span>
          <strong></strong>
          <em>${event.stage}</em>
        </span>
        <p></p>
        <small>${event.date || "未記錄"}｜${event.label || "未填方式"}</small>
      `;
      card.querySelector("strong").textContent = account.name;
      card.querySelector("p").textContent = summary;
      card.addEventListener("click", () => {
        selectedCrmAccountId = account.id;
        document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
        document.querySelector('[data-view="crm"]').classList.add("active");
        document.querySelector("#crm").classList.add("active");
        renderCrm();
      });
      list.append(card);
    });
}

function openCrmAccountEditor(accountId = "") {
  const account = accountId ? getCrmAccount(accountId) : null;
  renderCrmStageOptions(document.querySelector("#crmAccountStage"));
  document.querySelector("#crmAccountDialogTitle").textContent = account ? "編輯客戶" : "新增客戶";
  document.querySelector("#crmAccountId").value = account?.id || "";
  document.querySelector("#crmAccountName").value = account?.name || "";
  document.querySelector("#crmAccountStage").value = account?.stage || "尚未聯絡";
  document.querySelector("#crmAccountLocation").value = account?.location || "";
  document.querySelector("#crmAccountCategory").value = account?.category || "";
  document.querySelector("#crmAccountBirthday").value = account?.birthday || "";
  document.querySelector("#crmAccountOccupation").value = account?.occupation || "";
  document.querySelector("#crmAccountPretaxIncome").value = account?.pretaxIncome || "";
  document.querySelector("#crmAccountMeetingCount").value = account ? `${getCrmMeetingCount(account)} 次` : "0 次";
  document.querySelector("#crmAccountPolicies").value = account?.policies || "";
  document.querySelector("#crmAccountPolicyStatus").value = account?.policyStatus || "";
  document.querySelector("#crmAccountBackground").value = account?.background || "";
  document.querySelector("#crmAccountNextStep").value = account?.nextStep || "";
  document.querySelector("#crmAccountNextFollowUp").value = account?.nextFollowUpDate || "";
  document.querySelector("#crmAccountNotes").value = account?.notes || "";
  document.querySelector("#deleteCrmAccountBtn").hidden = !account;
  document.querySelector("#crmAccountDialog").showModal();
}

function closeCrmAccountEditor() {
  document.querySelector("#crmAccountDialog").close();
}

function saveCrmAccount() {
  const id = document.querySelector("#crmAccountId").value || crypto.randomUUID();
  const name = document.querySelector("#crmAccountName").value.trim();
  if (!name) {
    alert("請先輸入客戶姓名。");
    return;
  }

  const existing = crmState.accounts.find((account) => account.id === id);
  const account = normalizeCrmAccount({
    ...(existing || {}),
    id,
    name,
    stage: document.querySelector("#crmAccountStage").value,
    location: document.querySelector("#crmAccountLocation").value.trim(),
    category: document.querySelector("#crmAccountCategory").value.trim(),
    birthday: document.querySelector("#crmAccountBirthday").value,
    occupation: document.querySelector("#crmAccountOccupation").value.trim(),
    pretaxIncome: document.querySelector("#crmAccountPretaxIncome").value.trim(),
    policies: document.querySelector("#crmAccountPolicies").value.trim(),
    policyStatus: document.querySelector("#crmAccountPolicyStatus").value.trim(),
    background: document.querySelector("#crmAccountBackground").value.trim(),
    nextStep: document.querySelector("#crmAccountNextStep").value.trim(),
    nextFollowUpDate: document.querySelector("#crmAccountNextFollowUp").value,
    notes: document.querySelector("#crmAccountNotes").value.trim(),
    updatedAt: new Date().toISOString()
  });

  const index = crmState.accounts.findIndex((item) => item.id === id);
  if (index >= 0) crmState.accounts[index] = account;
  else crmState.accounts.push(account);
  selectedCrmAccountId = id;
  closeCrmAccountEditor();
  saveCrmState();
}

function deleteCrmAccount() {
  const id = document.querySelector("#crmAccountId").value;
  const account = getCrmAccount(id);
  if (!account) return;
  if (!confirm(`確定刪除 ${account.name}？這也會刪除他的拜訪紀錄。`)) return;
  deleteCrmAccountFromCloud(id);
  crmState.accounts = crmState.accounts.filter((item) => item.id !== id);
  crmState.visits = crmState.visits.filter((visit) => visit.accountId !== id);
  selectedCrmAccountId = crmState.accounts[0]?.id || "";
  closeCrmAccountEditor();
  saveCrmState();
}

function deleteCrmVisit(accountId, visitId) {
  const account = getCrmAccount(accountId);
  const visit = crmState.visits.find((item) => item.id === visitId);
  if (!account || !visit) return;
  if (!confirm("確定刪除這筆拜訪紀錄？")) return;

  deleteCrmVisitFromCloud(visitId);
  crmState.visits = crmState.visits.filter((item) => item.id !== visitId);
  applyLatestVisitToCrmAccount(account);
  saveCrmState();
}

function saveCrmVisit(accountId, formData) {
  const account = getCrmAccount(accountId);
  if (!account) return;
  const visitId = String(formData.get("visitId") || "");
  const existingVisit = crmState.visits.find((item) => item.id === visitId);
  const visit = normalizeCrmVisit({
    id: visitId || crypto.randomUUID(),
    accountId,
    date: formData.get("date"),
    method: formData.get("method"),
    stageAfter: formData.get("stageAfter"),
    summary: String(formData.get("summary") || "").trim(),
    result: String(formData.get("result") || "").trim(),
    nextStep: String(formData.get("nextStep") || "").trim(),
    nextFollowUpDate: formData.get("nextFollowUpDate"),
    pretaxIncome: String(formData.get("pretaxIncome") || "").trim(),
    createdAt: existingVisit?.createdAt
  });
  const index = crmState.visits.findIndex((item) => item.id === visit.id);
  if (index >= 0) crmState.visits[index] = visit;
  else crmState.visits.push(visit);

  applyLatestVisitToCrmAccount(account, account.stage);
  saveCrmState();
}

function bindCrmActions() {
  document.querySelector("#addCrmAccountBtn").addEventListener("click", () => openCrmAccountEditor());
  document.querySelector("#importCrmLegacyBtn").addEventListener("click", () => {
    setCrmImportStatus("會依表頭對應舊欄位；登入 Supabase 後會同步寫入 CRM 資料表。");
    document.querySelector("#crmImportDialog").showModal();
  });
  document.querySelector("#cancelCrmImportBtn").addEventListener("click", () => {
    document.querySelector("#crmImportDialog").close();
  });
  document.querySelector("#crmImportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = document.querySelector("#crmImportFile").files[0];
    const pasted = document.querySelector("#crmImportText").value;
    const text = file ? await file.text() : pasted;
    const result = importLegacyCrmRows(text, {
      sourceType: file ? "csv" : "pasted_table",
      sourceName: document.querySelector("#crmImportSourceName").value.trim(),
      sourceUrl: document.querySelector("#crmImportSourceUrl").value.trim()
    });
    if (!result.imported) {
      setCrmImportStatus(`匯入失敗：${result.reason || "沒有可匯入的客戶資料。"}`);
      return;
    }
    const cloudMessage = supabaseSession?.user ? "，並已加入 Supabase 同步" : "；尚未登入 Supabase，暫存在此瀏覽器";
    setCrmImportStatus(`已匯入 ${result.imported} 位客戶，略過 ${result.skipped} 列${cloudMessage}。`);
    document.querySelector("#crmImportText").value = "";
    document.querySelector("#crmImportFile").value = "";
    renderCrm();
    if (supabaseSession?.user) await saveCrmToCloud(true);
  });
  document.querySelector("#crmSearch").addEventListener("input", renderCrm);
  document.querySelector("#crmStageFilter").addEventListener("change", (event) => {
    selectedCrmStageFilter = event.target.value;
    renderCrm();
  });
  document.querySelector("#crmAccountForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveCrmAccount();
  });
  document.querySelector("#cancelCrmAccountBtn").addEventListener("click", closeCrmAccountEditor);
  document.querySelector("#deleteCrmAccountBtn").addEventListener("click", deleteCrmAccount);
}

function bindFunnelActions() {
  document.querySelector("#funnelYear").addEventListener("input", (event) => {
    selectedFunnelYear = Number(event.target.value) || new Date().getFullYear();
    renderFunnel();
  });
  document.querySelector("#funnelHalf").addEventListener("change", (event) => {
    selectedFunnelHalf = event.target.value;
    renderFunnel();
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

function createWeeklyGoalTodoBlock(title, items) {
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
      const label = document.createElement("label");
      label.className = "todo-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      const text = document.createElement("span");
      text.textContent = item.text;
      checkbox.addEventListener("change", () => {
        state.roles[item.roleIndex].goalDone[item.goalIndex] = checkbox.checked;
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
    ? state.roles.flatMap((role, currentRoleIndex) => role.goals.map((goal, goalIndex) => ({
      text: goal,
      done: Boolean(role.goalDone?.[goalIndex]),
      roleIndex: currentRoleIndex,
      goalIndex
    })).filter((goal) => isFilled(goal.text)))
    : (state.roles[roleIndex]?.goals || []).map((goal, goalIndex) => ({
      text: goal,
      done: Boolean(state.roles[roleIndex]?.goalDone?.[goalIndex]),
      roleIndex,
      goalIndex
    })).filter((goal) => isFilled(goal.text));
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
    createWeeklyGoalTodoBlock("本週目標", roleItems),
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

  document.querySelector("#syncCrmToCloudBtn").addEventListener("click", async () => {
    if (!supabaseClient || !supabaseSession?.user) {
      updateSupabaseStatus("請先登入 Supabase，再同步 CRM 到雲端。");
      return;
    }
    setSupabaseStatus("正在同步 CRM 到 Supabase...");
    await saveCrmToCloud(true);
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
    state.roles.push({
      roles: ["", ""],
      goals: ["", "", ""],
      goalDone: [false, false, false],
      color: roleColors[state.roles.length % roleColors.length]
    });
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
  bindCrmActions();
  bindFunnelActions();
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
  renderCrm();
  renderFunnel();
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
