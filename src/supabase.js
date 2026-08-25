import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const DEFAULT_CATEGORIES = [
  { name: "Moradia", type: "expense", icon: "uil-home" },
  { name: "Alimentação", type: "expense", icon: "uil-utensils" },
  { name: "Transporte", type: "expense", icon: "uil-car" },
  { name: "Saúde", type: "expense", icon: "uil-heart-medical" },
  { name: "Educação", type: "expense", icon: "uil-graduation-cap" },
  { name: "Lazer", type: "expense", icon: "uil-ticket" },
  { name: "Assinaturas", type: "expense", icon: "uil-repeat" },
  { name: "Compras", type: "expense", icon: "uil-shopping-bag" },
  { name: "Impostos", type: "expense", icon: "uil-file-check-alt" },
  { name: "Outros", type: "expense", icon: "uil-ellipsis-h" },
  { name: "Salário", type: "income", icon: "uil-briefcase-alt" },
  { name: "Freelance", type: "income", icon: "uil-laptop" },
  { name: "Investimentos", type: "income", icon: "uil-chart-growth" },
  { name: "Reembolso", type: "income", icon: "uil-redo" },
  { name: "Outros", type: "income", icon: "uil-ellipsis-h" }
];

function requireClient() {
  if (!supabase) throw new Error("Supabase não configurado.");
  return supabase;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function authRedirectUrl() {
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).href;
}

export async function sendMagicLink(email) {
  return unwrap(await requireClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authRedirectUrl() }
  }));
}

export async function signOut() {
  return unwrap(await requireClient().auth.signOut());
}

export async function ensureUserData(user) {
  const client = requireClient();
  const profileResult = await client.from("profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  unwrap(profileResult);
  if (!profileResult.data) {
    unwrap(await client.from("profiles").insert({
      user_id: user.id,
      name: String(user.user_metadata?.name || "").slice(0, 80),
      cycle_start_day: 1
    }));
  }

  const categoryResult = await client.from("categories").select("name,type").eq("user_id", user.id);
  const existing = unwrap(categoryResult);
  const existingKeys = new Set(existing.map((item) => `${item.type}:${item.name.toLocaleLowerCase("pt-BR")}`));
  const missing = DEFAULT_CATEGORIES
    .filter((item) => !existingKeys.has(`${item.type}:${item.name.toLocaleLowerCase("pt-BR")}`))
    .map((item) => ({ ...item, user_id: user.id }));
  if (missing.length) unwrap(await client.from("categories").insert(missing));
}

export async function loadUserData(userId) {
  const client = requireClient();
  const [profileResult, categoryResult, transactionResult, budgetResult] = await Promise.all([
    client.from("profiles").select("name,cycle_start_day").eq("user_id", userId).single(),
    client.from("categories").select("id,name,type,icon").eq("user_id", userId).order("type").order("name"),
    client.from("transactions").select("id,category_id,type,description,amount,occurred_on,status,source_transaction_id,external_key,created_at").eq("user_id", userId).order("occurred_on", { ascending: false }),
    client.from("budgets").select("id,category_id,cycle_start,amount,created_at").eq("user_id", userId).order("cycle_start", { ascending: false })
  ]);

  const profile = unwrap(profileResult);
  const categories = unwrap(categoryResult);
  const transactions = unwrap(transactionResult).map((item) => ({
    id: item.id,
    categoryId: item.category_id,
    type: item.type,
    description: item.description,
    amount: Number(item.amount),
    date: item.occurred_on,
    status: item.status,
    sourceId: item.source_transaction_id,
    externalKey: item.external_key,
    createdAt: item.created_at
  }));
  const budgets = unwrap(budgetResult).map((item) => ({
    id: item.id,
    categoryId: item.category_id,
    cycleKey: item.cycle_start,
    amount: Number(item.amount),
    createdAt: item.created_at
  }));

  return {
    settings: { name: profile.name || "", cycleStartDay: profile.cycle_start_day || 1 },
    categories,
    transactions,
    budgets
  };
}

export async function saveTransaction(userId, transaction, repeatNextCycle = false) {
  const client = requireClient();
  const payload = {
    user_id: userId,
    category_id: transaction.categoryId,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    occurred_on: transaction.date,
    status: transaction.status
  };

  if (transaction.id) {
    unwrap(await client.from("transactions").update(payload).eq("id", transaction.id).eq("user_id", userId).select("id").single());
    return;
  }

  const created = unwrap(await client.from("transactions").insert(payload).select("id").single());
  if (repeatNextCycle) {
    unwrap(await client.from("transactions").insert({
      ...payload,
      occurred_on: transaction.nextDate,
      status: "pending",
      source_transaction_id: created.id
    }));
  }
}

export async function deleteTransaction(userId, id) {
  unwrap(await requireClient().from("transactions").delete().eq("id", id).eq("user_id", userId));
}

export async function setTransactionStatus(userId, id, status) {
  unwrap(await requireClient().from("transactions").update({ status }).eq("id", id).eq("user_id", userId).select("id").single());
}

export async function saveBudget(userId, budget) {
  const client = requireClient();
  const payload = {
    user_id: userId,
    category_id: budget.categoryId,
    cycle_start: budget.cycleKey,
    amount: budget.amount
  };
  if (budget.id) {
    unwrap(await client.from("budgets").update(payload).eq("id", budget.id).eq("user_id", userId).select("id").single());
  } else {
    unwrap(await client.from("budgets").insert(payload));
  }
}

export async function deleteBudget(userId, id) {
  unwrap(await requireClient().from("budgets").delete().eq("id", id).eq("user_id", userId));
}

export async function saveProfile(userId, settings) {
  unwrap(await requireClient().from("profiles").update({
    name: settings.name,
    cycle_start_day: settings.cycleStartDay
  }).eq("user_id", userId).select("user_id").single());
}

export async function importBackupToSupabase(userId, backup) {
  const client = requireClient();
  await saveProfile(userId, backup.settings);

  const importedCategories = new Map();
  for (const transaction of backup.transactions) {
    importedCategories.set(`${transaction.type}:${transaction.category.toLocaleLowerCase("pt-BR")}`, {
      user_id: userId,
      type: transaction.type,
      name: transaction.category,
      icon: "uil-tag-alt"
    });
  }
  for (const budget of backup.budgets) {
    importedCategories.set(`expense:${budget.category.toLocaleLowerCase("pt-BR")}`, {
      user_id: userId,
      type: "expense",
      name: budget.category,
      icon: "uil-tag-alt"
    });
  }
  if (importedCategories.size) {
    unwrap(await client.from("categories").upsert([...importedCategories.values()], {
      onConflict: "user_id,type,name",
      ignoreDuplicates: true
    }));
  }

  const categories = unwrap(await client.from("categories").select("id,name,type").eq("user_id", userId));
  const categoryMap = new Map(categories.map((item) => [`${item.type}:${item.name.toLocaleLowerCase("pt-BR")}`, item.id]));

  if (backup.transactions.length) {
    const transactions = backup.transactions.map((item) => ({
      user_id: userId,
      category_id: categoryMap.get(`${item.type}:${item.category.toLocaleLowerCase("pt-BR")}`),
      type: item.type,
      description: item.description,
      amount: item.amount,
      occurred_on: item.date,
      status: item.status,
      external_key: item.externalKey
    }));
    unwrap(await client.from("transactions").upsert(transactions, { onConflict: "user_id,external_key" }));
  }

  if (backup.budgets.length) {
    const budgets = backup.budgets.map((item) => ({
      user_id: userId,
      category_id: categoryMap.get(`expense:${item.category.toLocaleLowerCase("pt-BR")}`),
      cycle_start: item.cycleKey,
      amount: item.amount
    }));
    unwrap(await client.from("budgets").upsert(budgets, { onConflict: "user_id,cycle_start,category_id" }));
  }
}
