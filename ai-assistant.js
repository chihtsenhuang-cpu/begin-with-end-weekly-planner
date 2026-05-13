// AI 助理：提醒型功能（Layer 1，純規則，無 AI 呼叫）
// 依賴 app.js 已定義的全域：crmState、crmStages、getCrmVisits、isFilled、toDateInputValue、selectedCrmAccountId

const REMINDER_STAGNANT_DAYS = 7;
const REMINDER_CLOSED_DORMANT_DAYS = 60;
const REMINDER_BIRTHDAY_WINDOW_DAYS = 7;
const REMINDER_INSURANCE_AGE_WINDOW_DAYS = 30;
const STAGNANT_APPLICABLE_STAGES = ["初步聯繫", "財務＆保單分析", "說明與口頭", "建議書"];

function todayDateString() {
  return toDateInputValue(new Date());
}

function daysBetween(fromDateString, toDateString) {
  const from = new Date(`${fromDateString}T00:00:00`);
  const to = new Date(`${toDateString}T00:00:00`);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function addMonthsToDate(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function parseBirthday(birthday) {
  if (!isFilled(birthday)) return null;
  const date = new Date(`${birthday}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getNextBirthdayInfo(birthdayString, refDateString) {
  const birthday = parseBirthday(birthdayString);
  if (!birthday) return null;
  const ref = new Date(`${refDateString}T00:00:00`);
  let next = new Date(ref.getFullYear(), birthday.getMonth(), birthday.getDate());
  if (next < ref) {
    next = new Date(ref.getFullYear() + 1, birthday.getMonth(), birthday.getDate());
  }
  const daysUntil = Math.round((next - ref) / (1000 * 60 * 60 * 24));
  return { date: next, daysUntil };
}

function getLastBirthdayBeforeOrOn(birthdayString, refDateString) {
  const birthday = parseBirthday(birthdayString);
  if (!birthday) return null;
  const ref = new Date(`${refDateString}T00:00:00`);
  let last = new Date(ref.getFullYear(), birthday.getMonth(), birthday.getDate());
  if (last > ref) {
    last = new Date(ref.getFullYear() - 1, birthday.getMonth(), birthday.getDate());
  }
  return last;
}

function getInsuranceAgeBoundary(birthdayString, refDateString) {
  const lastBirthday = getLastBirthdayBeforeOrOn(birthdayString, refDateString);
  if (!lastBirthday) return null;
  const boundary = addMonthsToDate(lastBirthday, 6);
  const ref = new Date(`${refDateString}T00:00:00`);
  const daysUntil = Math.round((boundary - ref) / (1000 * 60 * 60 * 24));
  return { date: boundary, daysUntil };
}

function getLatestVisitDate(accountId) {
  const visits = getCrmVisits(accountId);
  if (!visits.length) return null;
  return visits.reduce((latest, visit) => {
    if (!visit.date) return latest;
    if (!latest || visit.date > latest) return visit.date;
    return latest;
  }, null);
}

function hasFutureFollowUp(account, today) {
  return isFilled(account.nextFollowUpDate) && account.nextFollowUpDate >= today;
}

// ─── 查詢函式（這些之後會變成 LangGraph 的 tools） ────────────────────────

function getReminderOverdueFollowUps() {
  const today = todayDateString();
  return crmState.accounts
    .filter((account) => isFilled(account.nextFollowUpDate) && account.nextFollowUpDate <= today)
    .map((account) => ({ account, dueDate: account.nextFollowUpDate }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function getReminderStagnant() {
  const today = todayDateString();
  const results = [];
  crmState.accounts.forEach((account) => {
    if (!STAGNANT_APPLICABLE_STAGES.includes(account.stage)) return;
    if (hasFutureFollowUp(account, today)) return;
    const latestVisitDate = getLatestVisitDate(account.id);
    if (!latestVisitDate) return;
    const days = daysBetween(latestVisitDate, today);
    if (days > REMINDER_STAGNANT_DAYS) {
      results.push({ account, lastVisitDate: latestVisitDate, days });
    }
  });
  return results.sort((a, b) => b.days - a.days);
}

function getReminderClosedDormant() {
  const today = todayDateString();
  const results = [];
  crmState.accounts.forEach((account) => {
    if (account.stage !== "成交") return;
    const latestVisitDate = getLatestVisitDate(account.id);
    if (!latestVisitDate) return;
    const days = daysBetween(latestVisitDate, today);
    if (days > REMINDER_CLOSED_DORMANT_DAYS) {
      results.push({ account, lastVisitDate: latestVisitDate, days });
    }
  });
  return results.sort((a, b) => b.days - a.days);
}

function getReminderBirthdayUpcoming() {
  const today = todayDateString();
  const results = [];
  crmState.accounts.forEach((account) => {
    const info = getNextBirthdayInfo(account.birthday, today);
    if (!info) return;
    if (info.daysUntil >= 0 && info.daysUntil <= REMINDER_BIRTHDAY_WINDOW_DAYS) {
      results.push({ account, daysUntil: info.daysUntil, birthdayDate: info.date });
    }
  });
  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

function getReminderInsuranceAgeBoundary() {
  const today = todayDateString();
  const results = [];
  crmState.accounts.forEach((account) => {
    const info = getInsuranceAgeBoundary(account.birthday, today);
    if (!info) return;
    if (info.daysUntil >= 0 && info.daysUntil <= REMINDER_INSURANCE_AGE_WINDOW_DAYS) {
      results.push({ account, daysUntil: info.daysUntil, boundaryDate: info.date });
    }
  });
  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

function getReminderServicePending() {
  const results = [];
  crmState.visits.forEach((visit) => {
    if (visit.stageAfter !== "保服" && visit.stageAfter !== "理賠") return;
    if (visit.handled === true) return;
    const account = crmState.accounts.find((a) => a.id === visit.accountId);
    if (!account) return;
    results.push({ account, visit });
  });
  return results.sort((a, b) => (b.visit.date || "").localeCompare(a.visit.date || ""));
}

// ─── 渲染 ──────────────────────────────────────────────────────────────

function jumpToAccount(accountId) {
  selectedCrmAccountId = accountId;
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector('[data-view="crm"]').classList.add("active");
  document.querySelector("#crm").classList.add("active");
  renderCrm();
}

function formatBirthdayLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function buildReminderPanel(title, items, emptyText, renderItem) {
  const panel = document.createElement("section");
  panel.className = "settings-panel reminder-panel";
  const header = document.createElement("div");
  header.className = "reminder-panel-header";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const count = document.createElement("span");
  count.className = "reminder-count";
  count.textContent = items.length;
  header.append(h3, count);
  panel.append(header);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    panel.append(empty);
    return panel;
  }

  const list = document.createElement("ul");
  list.className = "reminder-list";
  items.forEach((item) => list.append(renderItem(item)));
  panel.append(list);
  return panel;
}

function buildAccountRow(account, secondaryText) {
  const li = document.createElement("li");
  li.className = "reminder-item";
  const link = document.createElement("button");
  link.type = "button";
  link.className = "reminder-link";
  const name = document.createElement("strong");
  name.textContent = account.name || "（未命名客戶）";
  const meta = document.createElement("small");
  meta.textContent = `${account.stage || "未設階段"}${account.location ? `｜${account.location}` : ""}`;
  link.append(name, meta);
  link.addEventListener("click", () => jumpToAccount(account.id));
  const secondary = document.createElement("span");
  secondary.className = "reminder-secondary";
  secondary.textContent = secondaryText;
  li.append(link, secondary);
  return li;
}

function renderReminders() {
  const container = document.querySelector("#remindersContent");
  if (!container) return;
  container.innerHTML = "";

  const overdue = getReminderOverdueFollowUps();
  const stagnant = getReminderStagnant();
  const dormant = getReminderClosedDormant();
  const birthday = getReminderBirthdayUpcoming();
  const insurance = getReminderInsuranceAgeBoundary();
  const service = getReminderServicePending();

  container.append(buildReminderPanel(
    "過期未跟進",
    overdue,
    "目前沒有過期的下次追蹤日。",
    ({ account, dueDate }) => buildAccountRow(account, `應追蹤 ${dueDate}`)
  ));

  container.append(buildReminderPanel(
    `停滯超過 ${REMINDER_STAGNANT_DAYS} 天`,
    stagnant,
    "沒有停滯太久的客戶。",
    ({ account, lastVisitDate, days }) => buildAccountRow(account, `${days} 天前｜${lastVisitDate}`)
  ));

  container.append(buildReminderPanel(
    `成交後 ${REMINDER_CLOSED_DORMANT_DAYS} 天沒互動`,
    dormant,
    "成交客戶都還有近期互動。",
    ({ account, lastVisitDate, days }) => buildAccountRow(account, `${days} 天前｜${lastVisitDate}`)
  ));

  container.append(buildReminderPanel(
    `生日 ${REMINDER_BIRTHDAY_WINDOW_DAYS} 天內`,
    birthday,
    "近期沒有客戶生日。",
    ({ account, daysUntil, birthdayDate }) => buildAccountRow(
      account,
      daysUntil === 0 ? "今天生日 🎂" : `${daysUntil} 天後｜${formatBirthdayLabel(birthdayDate)}`
    )
  ));

  container.append(buildReminderPanel(
    `保險年齡跳歲 ${REMINDER_INSURANCE_AGE_WINDOW_DAYS} 天內`,
    insurance,
    "近期沒有客戶要跳保險年齡。",
    ({ account, daysUntil, boundaryDate }) => buildAccountRow(
      account,
      `${daysUntil} 天後｜${formatBirthdayLabel(boundaryDate)} 跳歲`
    )
  ));

  container.append(buildReminderPanel(
    "保服／理賠待處理",
    service,
    "沒有未處理的保服／理賠紀錄。",
    ({ account, visit }) => buildAccountRow(account, `${visit.stageAfter}｜${visit.date}`)
  ));
}

document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.querySelector("#refreshRemindersBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", renderReminders);
});
