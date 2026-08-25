export const DEFAULT_SETTINGS = { name: "", cycleStartDay: 1 };

export function pad(number) {
  return String(number).padStart(2, "0");
}

export function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseLocalDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function addDays(date, amount) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  next.setDate(next.getDate() + amount);
  return next;
}

export function addMonthsToISO(value, amount) {
  const date = parseLocalDate(value);
  const originalDay = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return toISO(target);
}

export function getCycleRange(cycleStartDay, offset = 0, referenceDate = new Date()) {
  const day = Math.min(28, Math.max(1, Number(cycleStartDay) || 1));
  let start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day, 12);
  if (referenceDate.getDate() < day) {
    start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, day, 12);
  }
  start = new Date(start.getFullYear(), start.getMonth() + offset, day, 12);
  const nextStart = new Date(start.getFullYear(), start.getMonth() + 1, day, 12);
  const end = addDays(nextStart, -1);
  return { start, end, startISO: toISO(start), endISO: toISO(end) };
}

export function isInRange(value, range) {
  return value >= range.startISO && value <= range.endISO;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function sum(items, selector) {
  return items.reduce((total, item) => total + selector(item), 0);
}

export function computeCycleData({ transactions, budgets, cycleStartDay, offset = 0, referenceDate = new Date() }) {
  const range = getCycleRange(cycleStartDay, offset, referenceDate);
  const cycleTransactions = transactions.filter((item) => isInRange(item.date, range));
  const cycleBudgets = budgets.filter((item) => item.cycleKey === range.startISO);
  const incomes = cycleTransactions.filter((item) => item.type === "income");
  const expenses = cycleTransactions.filter((item) => item.type === "expense");
  const incomeExpected = sum(incomes, (item) => Number(item.amount));
  const incomePaid = sum(incomes.filter((item) => item.status === "paid"), (item) => Number(item.amount));
  const expenseCommitted = sum(expenses, (item) => Number(item.amount));
  const expensePaid = sum(expenses.filter((item) => item.status === "paid"), (item) => Number(item.amount));
  const budgetTotal = sum(cycleBudgets, (item) => Number(item.amount));
  const spentFor = (categoryId) => sum(expenses.filter((item) => item.categoryId === categoryId), (item) => Number(item.amount));
  const budgetSpent = sum(cycleBudgets, (budget) => spentFor(budget.categoryId));
  const uncommittedBudget = sum(cycleBudgets, (budget) => Math.max(0, Number(budget.amount) - spentFor(budget.categoryId)));

  return {
    range,
    transactions: cycleTransactions,
    budgets: cycleBudgets,
    incomes,
    expenses,
    incomeExpected,
    incomePaid,
    expenseCommitted,
    expensePaid,
    budgetTotal,
    budgetSpent,
    uncommittedBudget,
    safeToSpend: incomeExpected - expenseCommitted - uncommittedBudget,
    realizedResult: incomePaid - expensePaid
  };
}

export function getCycleTimeProgress(range, currentDate = new Date()) {
  const today = parseLocalDate(toISO(currentDate));
  if (today < range.start) return 0;
  if (today > range.end) return 100;
  return clamp(Math.round(((today - range.start) / (range.end - range.start)) * 100), 0, 100);
}

export function normalizeBackup(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
  const budgets = Array.isArray(parsed?.budgets) ? parsed.budgets : [];
  const settings = parsed?.settings || DEFAULT_SETTINGS;
  return {
    settings: {
      name: String(settings.name || "").slice(0, 40),
      cycleStartDay: clamp(Number(settings.cycleStartDay) || 1, 1, 28)
    },
    transactions: transactions
      .map((item) => ({
        externalKey: item.id ? `local:${String(item.id)}` : null,
        type: item.type === "income" ? "income" : "expense",
        description: String(item.description || item.desc || "Sem descrição").slice(0, 80),
        amount: Number(item.amount),
        date: item.date,
        category: String(item.category || "Outros").slice(0, 40),
        status: item.status === "pending" ? "pending" : "paid"
      }))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.amount) && item.amount > 0),
    budgets: budgets
      .map((item) => ({ cycleKey: item.cycleKey, category: String(item.category || "Outros").slice(0, 40), amount: Number(item.amount) }))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.cycleKey) && Number.isFinite(item.amount) && item.amount > 0)
  };
}
