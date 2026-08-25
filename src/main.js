import "../style.css";
import {
  addDays,
  addMonthsToISO,
  clamp,
  computeCycleData,
  getCycleTimeProgress,
  normalizeBackup,
  parseLocalDate,
  sum,
  todayISO,
  toISO
} from "./finance.js";
import {
  deleteBudget as deleteBudgetRemote,
  deleteTransaction as deleteTransactionRemote,
  ensureUserData,
  importBackupToSupabase,
  isSupabaseConfigured,
  loadUserData,
  saveBudget as saveBudgetRemote,
  saveProfile,
  saveTransaction as saveTransactionRemote,
  sendMagicLink,
  setTransactionStatus,
  signOut,
  supabase
} from "./supabase.js";

let state = { settings: { name: "", cycleStartDay: 1 }, categories: [], transactions: [], budgets: [] };
let currentUser = null;
let sessionPromise = null;
let cycleOffset = 0;
let activeView = "dashboard";
let typeFilter = "all";
let statusFilter = "all";
let searchTerm = "";

const formatCurrency = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const formatDate = (value) => parseLocalDate(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const formatCycle = (range) => `${formatDate(range.startISO)} — ${formatDate(range.endISO)}`;

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function categoryById(id) {
  return state.categories.find((item) => item.id === id) || { name: "Outros", icon: "uil-tag-alt", type: "expense" };
}

function categoriesFor(type) {
  return state.categories.filter((item) => item.type === type).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function setScreen(screen) {
  document.getElementById("boot-screen").classList.toggle("hidden", screen !== "boot");
  document.getElementById("auth-screen").classList.toggle("hidden", screen !== "auth");
  document.getElementById("app-shell").classList.toggle("hidden", screen !== "app");
}

function setSyncStatus(status, label) {
  const element = document.getElementById("sync-status");
  element.className = `sync-status ${status === "synced" ? "" : status}`;
  element.querySelector("i").className = `uil ${status === "error" ? "uil-cloud-times" : "uil-cloud-check"}`;
  element.querySelector("span").textContent = label;
}

async function reloadData() {
  setSyncStatus("syncing", "Sincronizando...");
  state = await loadUserData(currentUser.id);
  renderAll();
  setSyncStatus("synced", "Sincronizado");
}

async function runMutation(action, successMessage, modalId = "") {
  setSyncStatus("syncing", "Salvando...");
  try {
    await action();
    await reloadData();
    if (modalId) closeModal(modalId);
    if (successMessage) showToast(successMessage);
    return true;
  } catch (error) {
    console.error(error);
    setSyncStatus("error", "Falha ao sincronizar");
    showToast(error.message || "Não foi possível salvar. Tente novamente.", "error");
    return false;
  }
}

async function enterUserSession(user) {
  if (sessionPromise) return sessionPromise;
  if (currentUser?.id === user.id && !document.getElementById("app-shell").classList.contains("hidden")) return;
  sessionPromise = (async () => {
    setScreen("boot");
    currentUser = user;
    try {
      await ensureUserData(user);
      await reloadData();
      document.getElementById("sidebar-user-email").textContent = user.email || "Conta MYCFO";
      document.getElementById("sidebar-user-name").textContent = state.settings.name || "Minha conta";
      setScreen("app");
      updateMigrationBanner();
    } catch (error) {
      console.error(error);
      currentUser = null;
      setScreen("auth");
      setAuthMessage(`Não foi possível carregar seus dados: ${error.message}`, true);
    }
  })();
  try { await sessionPromise; } finally { sessionPromise = null; }
}

function leaveUserSession() {
  currentUser = null;
  state = { settings: { name: "", cycleStartDay: 1 }, categories: [], transactions: [], budgets: [] };
  cycleOffset = 0;
  setScreen("auth");
}

function setAuthMessage(message, isError = false) {
  const element = document.getElementById("auth-message");
  element.textContent = message;
  element.classList.toggle("error", isError);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type='submit']");
  const email = document.getElementById("auth-email").value.trim();
  button.disabled = true;
  button.innerHTML = '<i class="uil uil-spinner-alt"></i>Enviando...';
  setAuthMessage("");
  try {
    await sendMagicLink(email);
    setAuthMessage("Link enviado. Abra seu e-mail e clique para entrar no MYCFO.");
  } catch (error) {
    console.error(error);
    setAuthMessage(error.message || "Não foi possível enviar o link.", true);
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="uil uil-envelope-check"></i>Receber link de acesso';
  }
}

function getCycleData() {
  return computeCycleData({
    transactions: state.transactions,
    budgets: state.budgets,
    cycleStartDay: state.settings.cycleStartDay,
    offset: cycleOffset
  });
}

function populateCategorySelect(select, type, selected = "") {
  const categories = categoriesFor(type);
  select.innerHTML = categories.map((item) => `<option value="${escapeHTML(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHTML(item.name)}</option>`).join("");
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `view-${view}`));
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  closeMobileMenu();
  if (view === "transactions") renderTransactions();
  if (view === "planning") renderPlanning();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openMobileMenu() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("mobile-backdrop").classList.add("active");
}

function closeMobileMenu() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("mobile-backdrop").classList.remove("active");
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => modal.querySelector("input:not([type='hidden']), select")?.focus(), 30);
}

function closeModal(modal) {
  const overlay = typeof modal === "string" ? document.getElementById(modal) : modal.closest(".modal-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-overlay.active")) document.body.style.overflow = "";
}

function openTransactionModal(id = "") {
  const form = document.getElementById("transaction-form");
  form.reset();
  document.getElementById("transaction-id").value = "";
  document.getElementById("transaction-date").value = todayISO();
  document.getElementById("transaction-modal-title").textContent = "Novo lançamento";
  populateCategorySelect(document.getElementById("transaction-category"), "expense");
  if (id) {
    const item = state.transactions.find((transaction) => transaction.id === id);
    if (!item) return;
    document.getElementById("transaction-id").value = item.id;
    document.querySelector(`input[name="transaction-type"][value="${item.type}"]`).checked = true;
    document.getElementById("transaction-description").value = item.description;
    document.getElementById("transaction-amount").value = item.amount;
    document.getElementById("transaction-date").value = item.date;
    document.getElementById("transaction-status").value = item.status;
    populateCategorySelect(document.getElementById("transaction-category"), item.type, item.categoryId);
    document.getElementById("transaction-repeat").checked = false;
    document.getElementById("transaction-modal-title").textContent = "Editar lançamento";
  }
  openModal("transaction-modal");
}

function openBudgetModal(id = "") {
  const form = document.getElementById("budget-form");
  form.reset();
  document.getElementById("budget-id").value = "";
  populateCategorySelect(document.getElementById("budget-category"), "expense");
  document.getElementById("budget-modal-title").textContent = "Planejar categoria";
  if (id) {
    const budget = state.budgets.find((item) => item.id === id);
    if (!budget) return;
    document.getElementById("budget-id").value = budget.id;
    document.getElementById("budget-category").value = budget.categoryId;
    document.getElementById("budget-amount").value = budget.amount;
    document.getElementById("budget-modal-title").textContent = "Editar planejamento";
  }
  openModal("budget-modal");
}

function openSettingsModal() {
  document.getElementById("user-name").value = state.settings.name;
  document.getElementById("cycle-start-day").value = state.settings.cycleStartDay;
  openModal("settings-modal");
}

async function handleTransactionSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("transaction-id").value;
  const type = document.querySelector("input[name='transaction-type']:checked").value;
  const amount = Number(document.getElementById("transaction-amount").value);
  const date = document.getElementById("transaction-date").value;
  const description = document.getElementById("transaction-description").value.trim();
  if (!description || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast("Revise descrição, valor e data.", "error");
    return;
  }
  const repeat = document.getElementById("transaction-repeat").checked && !id;
  await runMutation(
    () => saveTransactionRemote(currentUser.id, {
      id: id || null,
      type,
      description: description.slice(0, 80),
      amount,
      date,
      categoryId: document.getElementById("transaction-category").value,
      status: document.getElementById("transaction-status").value === "pending" ? "pending" : "paid",
      nextDate: addMonthsToISO(date, 1)
    }, repeat),
    id ? "Lançamento atualizado." : "Lançamento salvo na nuvem.",
    "transaction-modal"
  );
}

async function handleBudgetSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("budget-id").value;
  const categoryId = document.getElementById("budget-category").value;
  const amount = Number(document.getElementById("budget-amount").value);
  if (!Number.isFinite(amount) || amount <= 0) return showToast("Informe um limite maior que zero.", "error");
  const range = getCycleData().range;
  const duplicate = state.budgets.find((item) => item.cycleKey === range.startISO && item.categoryId === categoryId && item.id !== id);
  if (duplicate) return showToast("Essa categoria já foi planejada neste ciclo.", "error");
  await runMutation(
    () => saveBudgetRemote(currentUser.id, { id: id || null, categoryId, cycleKey: range.startISO, amount }),
    id ? "Planejamento atualizado." : "Categoria planejada.",
    "budget-modal"
  );
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const settings = {
    name: document.getElementById("user-name").value.trim().slice(0, 80),
    cycleStartDay: clamp(Number(document.getElementById("cycle-start-day").value) || 1, 1, 28)
  };
  const saved = await runMutation(() => saveProfile(currentUser.id, settings), "Preferências salvas.", "settings-modal");
  if (saved) {
    cycleOffset = 0;
    document.getElementById("sidebar-user-name").textContent = state.settings.name || "Minha conta";
  }
}

async function deleteTransaction(id) {
  const item = state.transactions.find((transaction) => transaction.id === id);
  if (!item || !window.confirm(`Excluir "${item.description}"? Essa ação não pode ser desfeita.`)) return;
  await runMutation(() => deleteTransactionRemote(currentUser.id, id), "Lançamento excluído.");
}

async function toggleTransaction(id) {
  const item = state.transactions.find((transaction) => transaction.id === id);
  if (!item) return;
  await runMutation(() => setTransactionStatus(currentUser.id, id, item.status === "paid" ? "pending" : "paid"), "Status atualizado.");
}

async function deleteBudget(id) {
  const item = state.budgets.find((budget) => budget.id === id);
  const category = item ? categoryById(item.categoryId) : null;
  if (!item || !window.confirm(`Remover o planejamento de ${category.name}?`)) return;
  await runMutation(() => deleteBudgetRemote(currentUser.id, id), "Planejamento removido.");
}

function renderCycleHeader() {
  const range = getCycleData().range;
  document.getElementById("cycle-label").textContent = formatCycle(range);
  document.querySelector("#current-cycle-button span").textContent = cycleOffset === 0 ? "Ciclo atual" : cycleOffset < 0 ? "Ciclo anterior" : "Ciclo futuro";
  const name = state.settings.name ? `, ${state.settings.name.split(" ")[0]}` : "";
  document.getElementById("greeting").textContent = `OLÁ${name.toUpperCase()}`;
  const today = parseLocalDate(todayISO());
  const days = Math.max(0, Math.ceil((range.end - today) / 86400000));
  document.getElementById("cycle-summary").textContent = cycleOffset === 0
    ? `${days} dia${days === 1 ? "" : "s"} até o fechamento. Organize o que entrou e proteja o que ainda vai sair.`
    : `Visualizando o período de ${formatCycle(range)}.`;
}

function renderDashboard() {
  const data = getCycleData();
  const budgetPercent = data.budgetTotal ? Math.round((data.budgetSpent / data.budgetTotal) * 100) : 0;
  const timeProgress = getCycleTimeProgress(data.range);
  const safe = document.getElementById("safe-to-spend");
  safe.textContent = formatCurrency(data.safeToSpend);
  safe.style.color = data.safeToSpend < 0 ? "#ffad98" : "";
  document.getElementById("safe-caption").textContent = data.budgetTotal ? `Inclui ${formatCurrency(data.uncommittedBudget)} ainda reservado` : "Crie um planejamento para tornar este valor mais seguro";
  const realized = document.getElementById("realized-result");
  realized.textContent = formatCurrency(data.realizedResult);
  realized.classList.toggle("negative", data.realizedResult < 0);
  document.getElementById("cycle-income").textContent = formatCurrency(data.incomeExpected);
  document.getElementById("income-caption").textContent = `${formatCurrency(data.incomePaid)} já recebido`;
  document.getElementById("cycle-expense").textContent = formatCurrency(data.expenseCommitted);
  document.getElementById("expense-caption").textContent = `${formatCurrency(data.expensePaid)} já pago`;
  document.getElementById("budget-total").textContent = formatCurrency(data.budgetTotal);
  document.getElementById("budget-spent").textContent = formatCurrency(data.budgetSpent);
  document.getElementById("budget-percent").textContent = `${budgetPercent}%`;
  document.getElementById("time-progress").textContent = `${timeProgress}%`;
  document.getElementById("budget-ring").style.setProperty("--progress", `${clamp(budgetPercent, 0, 100) * 3.6}deg`);

  const status = document.getElementById("budget-status");
  status.className = "status-chip";
  if (!data.budgetTotal) status.textContent = "Sem planejamento";
  else if (budgetPercent > 100) { status.textContent = "Limite ultrapassado"; status.classList.add("danger"); }
  else if (budgetPercent > timeProgress + 15) { status.textContent = "Ritmo acelerado"; status.classList.add("warning"); }
  else status.textContent = "Ritmo saudável";
  renderUpcoming();
  renderRecent(data.transactions);
}

function transactionRow(item, mobile = false) {
  const category = categoryById(item.categoryId);
  const sign = item.type === "income" ? "+" : "−";
  const status = item.status === "paid" ? "Realizado" : "Pendente";
  const id = escapeHTML(item.id);
  if (mobile) {
    return `<div class="mobile-transaction-card"><div class="item-icon ${item.type}"><i class="uil ${escapeHTML(category.icon)}"></i></div><div class="item-copy"><strong>${escapeHTML(item.description)}</strong><span>${formatDate(item.date)} · ${escapeHTML(category.name)} · ${status}</span></div><div class="item-amount"><strong class="amount-${item.type}">${sign}${formatCurrency(item.amount)}</strong></div><div class="mobile-card-actions"><button class="row-action" data-action="toggle" data-id="${id}" title="Alterar status"><i class="uil uil-check-circle"></i></button><button class="row-action" data-action="edit" data-id="${id}" title="Editar"><i class="uil uil-pen"></i></button><button class="row-action delete" data-action="delete" data-id="${id}" title="Excluir"><i class="uil uil-trash-alt"></i></button></div></div>`;
  }
  return `<tr><td><div class="description-cell"><div class="item-icon ${item.type}"><i class="uil ${escapeHTML(category.icon)}"></i></div><strong>${escapeHTML(item.description)}</strong></div></td><td>${formatDate(item.date)}</td><td>${escapeHTML(category.name)}</td><td><button class="row-action status-dot ${item.status}" data-action="toggle" data-id="${id}" title="Alterar status">${status}</button></td><td class="amount-${item.type}">${sign}${formatCurrency(item.amount)}</td><td><div class="row-actions"><button class="row-action" data-action="edit" data-id="${id}" title="Editar"><i class="uil uil-pen"></i></button><button class="row-action delete" data-action="delete" data-id="${id}" title="Excluir"><i class="uil uil-trash-alt"></i></button></div></td></tr>`;
}

function renderRecent(transactions) {
  const list = document.getElementById("recent-transactions");
  const items = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  if (!items.length) {
    list.innerHTML = '<div class="empty-inline"><i class="uil uil-receipt-alt"></i><p>Nenhum lançamento neste ciclo.</p></div>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const category = categoryById(item.categoryId);
    const sign = item.type === "income" ? "+" : "−";
    return `<button class="transaction-row" data-action="edit" data-id="${escapeHTML(item.id)}" style="border-left:0;border-right:0;border-top:0;background:transparent;width:100%;text-align:left;cursor:pointer"><div class="item-icon ${item.type}"><i class="uil ${escapeHTML(category.icon)}"></i></div><div class="item-copy"><strong>${escapeHTML(item.description)}</strong><span>${formatDate(item.date)} · ${escapeHTML(category.name)}</span></div><div class="item-amount"><strong>${sign}${formatCurrency(item.amount)}</strong><span>${item.status === "paid" ? "realizado" : "pendente"}</span></div></button>`;
  }).join("");
}

function renderUpcoming() {
  const start = todayISO();
  const end = toISO(addDays(parseLocalDate(start), 7));
  const items = state.transactions.filter((item) => item.type === "expense" && item.status === "pending" && item.date >= start && item.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  document.getElementById("upcoming-count").textContent = items.length;
  const list = document.getElementById("upcoming-list");
  if (!items.length) {
    list.innerHTML = '<div class="empty-inline"><i class="uil uil-check-circle"></i><p>Nenhuma conta pendente nos próximos dias.</p></div>';
    return;
  }
  list.innerHTML = items.slice(0, 4).map((item) => {
    const category = categoryById(item.categoryId);
    return `<button class="stack-item" data-action="edit" data-id="${escapeHTML(item.id)}" style="border-left:0;border-right:0;border-top:0;background:transparent;width:100%;text-align:left;cursor:pointer"><div class="item-icon expense"><i class="uil ${escapeHTML(category.icon)}"></i></div><div class="item-copy"><strong>${escapeHTML(item.description)}</strong><span>vence ${formatDate(item.date)}</span></div><div class="item-amount"><strong>${formatCurrency(item.amount)}</strong><span>${escapeHTML(category.name)}</span></div></button>`;
  }).join("");
}

function filteredTransactions() {
  const range = getCycleData().range;
  const query = searchTerm.trim().toLocaleLowerCase("pt-BR");
  return state.transactions
    .filter((item) => item.date >= range.startISO && item.date <= range.endISO)
    .filter((item) => typeFilter === "all" || item.type === typeFilter)
    .filter((item) => statusFilter === "all" || item.status === statusFilter)
    .filter((item) => !query || `${item.description} ${categoryById(item.categoryId).name}`.toLocaleLowerCase("pt-BR").includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function renderTransactions() {
  const items = filteredTransactions();
  document.getElementById("transactions-table").innerHTML = items.map((item) => transactionRow(item)).join("");
  document.getElementById("mobile-transactions").innerHTML = items.map((item) => transactionRow(item, true)).join("");
  document.getElementById("transactions-empty").classList.toggle("hidden", items.length > 0);
}

function renderPlanning() {
  const data = getCycleData();
  document.getElementById("planning-total").textContent = formatCurrency(data.budgetTotal);
  document.getElementById("planning-used").textContent = formatCurrency(data.budgetSpent);
  document.getElementById("planning-remaining").textContent = formatCurrency(data.uncommittedBudget);
  document.getElementById("budgets-empty").classList.toggle("hidden", data.budgets.length > 0);
  const list = document.getElementById("budget-list");
  if (!data.budgets.length) { list.innerHTML = ""; return; }
  list.innerHTML = data.budgets.map((budget) => {
    const category = categoryById(budget.categoryId);
    const spent = sum(data.expenses.filter((item) => item.categoryId === budget.categoryId), (item) => item.amount);
    const percent = budget.amount ? Math.round((spent / budget.amount) * 100) : 0;
    const tone = percent > 100 ? "danger" : percent >= 80 ? "warning" : "";
    const remaining = budget.amount - spent;
    return `<article class="budget-card"><div class="budget-card-top"><div class="budget-card-name"><div class="item-icon"><i class="uil ${escapeHTML(category.icon)}"></i></div><strong>${escapeHTML(category.name)}</strong></div><div class="row-actions"><button class="row-action" data-budget-action="edit" data-id="${escapeHTML(budget.id)}" title="Editar"><i class="uil uil-pen"></i></button><button class="row-action delete" data-budget-action="delete" data-id="${escapeHTML(budget.id)}" title="Excluir"><i class="uil uil-trash-alt"></i></button></div></div><div class="budget-card-values"><span><strong>${formatCurrency(spent)}</strong> utilizados</span><span>${percent}% de ${formatCurrency(budget.amount)}</span></div><div class="progress-track"><div class="progress-fill ${tone}" style="width:${clamp(percent, 0, 100)}%"></div></div>${remaining < 0 ? `<p class="budget-over">Limite ultrapassado em ${formatCurrency(Math.abs(remaining))}</p>` : ""}</article>`;
  }).join("");
}

function renderAll() {
  renderCycleHeader();
  renderDashboard();
  renderTransactions();
  renderPlanning();
}

function buildBackup() {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    transactions: state.transactions.map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      amount: item.amount,
      date: item.date,
      category: categoryById(item.categoryId).name,
      status: item.status
    })),
    budgets: state.budgets.map((item) => ({
      id: item.id,
      cycleKey: item.cycleKey,
      category: categoryById(item.categoryId).name,
      amount: item.amount
    }))
  };
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `mycfo-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Backup exportado.");
}

async function importBackupFile(file) {
  if (!file) return;
  try {
    const backup = normalizeBackup(await file.text());
    if (!backup.transactions.length && !backup.budgets.length) throw new Error("O arquivo não contém dados válidos.");
    if (!window.confirm(`Importar ${backup.transactions.length} lançamento(s) para sua conta?`)) return;
    const saved = await runMutation(() => importBackupToSupabase(currentUser.id, backup), "Dados importados para a nuvem.", "settings-modal");
    if (saved) localStorage.setItem(`mycfo_migrated_${currentUser.id}`, "true");
    updateMigrationBanner();
  } catch (error) {
    console.error(error);
    showToast(error.message || "O arquivo não é um backup MYCFO válido.", "error");
  }
}

function readLegacyBackup() {
  const current = localStorage.getItem("mycfo_state_v2");
  if (current) return normalizeBackup(current);
  const transactions = JSON.parse(localStorage.getItem("mycfo_transactions") || "[]");
  return normalizeBackup({ settings: { cycleStartDay: 1 }, transactions, budgets: [] });
}

function updateMigrationBanner() {
  const banner = document.getElementById("migration-banner");
  try {
    const backup = readLegacyBackup();
    const dismissed = localStorage.getItem(`mycfo_migration_dismissed_${currentUser.id}`) === "true";
    const migrated = localStorage.getItem(`mycfo_migrated_${currentUser.id}`) === "true";
    banner.classList.toggle("hidden", dismissed || migrated || backup.transactions.length + backup.budgets.length === 0);
  } catch {
    banner.classList.add("hidden");
  }
}

async function migrateLegacyData() {
  try {
    const backup = readLegacyBackup();
    if (!backup.transactions.length && !backup.budgets.length) return updateMigrationBanner();
    const saved = await runMutation(() => importBackupToSupabase(currentUser.id, backup), "Dados antigos importados com segurança.");
    if (saved) localStorage.setItem(`mycfo_migrated_${currentUser.id}`, "true");
    updateMigrationBanner();
  } catch (error) {
    console.error(error);
    showToast("Não foi possível ler os dados antigos.", "error");
  }
}

function showToast(message, type = "success") {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.innerHTML = `<i class="uil ${type === "error" ? "uil-exclamation-triangle" : "uil-check-circle"}"></i><span>${escapeHTML(message)}</span>`;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function bindEvents() {
  document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-go-to]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.goTo)));
  document.querySelectorAll("[data-add-transaction]").forEach((button) => button.addEventListener("click", () => openTransactionModal()));
  document.getElementById("quick-add").addEventListener("click", () => openTransactionModal());
  document.getElementById("add-budget").addEventListener("click", () => openBudgetModal());
  document.getElementById("empty-add-budget").addEventListener("click", () => openBudgetModal());
  document.getElementById("open-settings").addEventListener("click", openSettingsModal);
  document.getElementById("mobile-menu").addEventListener("click", openMobileMenu);
  document.getElementById("mobile-backdrop").addEventListener("click", closeMobileMenu);
  document.getElementById("sign-out").addEventListener("click", async () => {
    try { await signOut(); } catch (error) { showToast(error.message || "Não foi possível sair.", "error"); }
  });

  document.getElementById("previous-cycle").addEventListener("click", () => { cycleOffset -= 1; renderAll(); });
  document.getElementById("next-cycle").addEventListener("click", () => { cycleOffset += 1; renderAll(); });
  document.getElementById("current-cycle-button").addEventListener("click", () => { cycleOffset = 0; renderAll(); });
  document.querySelectorAll("input[name='transaction-type']").forEach((input) => input.addEventListener("change", () => populateCategorySelect(document.getElementById("transaction-category"), input.value)));
  document.getElementById("transaction-form").addEventListener("submit", handleTransactionSubmit);
  document.getElementById("budget-form").addEventListener("submit", handleBudgetSubmit);
  document.getElementById("settings-form").addEventListener("submit", handleSettingsSubmit);
  document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => closeModal(button)));
  document.querySelectorAll(".modal-overlay").forEach((overlay) => overlay.addEventListener("click", (event) => { if (event.target === overlay) closeModal(overlay.id); }));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.querySelectorAll(".modal-overlay.active").forEach((modal) => closeModal(modal.id)); });

  document.getElementById("type-filter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-type]");
    if (!button) return;
    typeFilter = button.dataset.filterType;
    document.querySelectorAll("[data-filter-type]").forEach((item) => item.classList.toggle("active", item === button));
    renderTransactions();
  });
  document.getElementById("status-filter").addEventListener("change", (event) => { statusFilter = event.target.value; renderTransactions(); });
  document.getElementById("global-search").addEventListener("input", (event) => {
    searchTerm = event.target.value;
    if (searchTerm && activeView !== "transactions") switchView("transactions");
    else renderTransactions();
  });

  document.body.addEventListener("click", (event) => {
    const transactionAction = event.target.closest("[data-action]");
    if (transactionAction) {
      const { action, id } = transactionAction.dataset;
      if (action === "edit") openTransactionModal(id);
      if (action === "delete") void deleteTransaction(id);
      if (action === "toggle") void toggleTransaction(id);
      return;
    }
    const budgetAction = event.target.closest("[data-budget-action]");
    if (budgetAction?.dataset.budgetAction === "edit") openBudgetModal(budgetAction.dataset.id);
    if (budgetAction?.dataset.budgetAction === "delete") void deleteBudget(budgetAction.dataset.id);
  });

  document.getElementById("export-backup").addEventListener("click", exportBackup);
  document.getElementById("import-backup").addEventListener("click", () => document.getElementById("backup-file").click());
  document.getElementById("backup-file").addEventListener("change", (event) => { void importBackupFile(event.target.files[0]); event.target.value = ""; });
  document.getElementById("migrate-local-data").addEventListener("click", () => void migrateLegacyData());
  document.getElementById("dismiss-migration").addEventListener("click", () => {
    localStorage.setItem(`mycfo_migration_dismissed_${currentUser.id}`, "true");
    updateMigrationBanner();
  });
}

async function initialize() {
  bindEvents();
  if (!isSupabaseConfigured) {
    document.getElementById("auth-form-wrap").classList.add("hidden");
    document.getElementById("config-error").classList.remove("hidden");
    setScreen("auth");
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (session?.user) void enterUserSession(session.user);
      else leaveUserSession();
    }, 0);
  });

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await enterUserSession(data.session.user);
    else setScreen("auth");
  } catch (error) {
    console.error(error);
    setAuthMessage(error.message || "Não foi possível iniciar a sessão.", true);
    setScreen("auth");
  }
}

document.addEventListener("DOMContentLoaded", () => void initialize());
