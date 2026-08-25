import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsToISO, computeCycleData, getCycleRange, normalizeBackup, parseLocalDate } from "../src/finance.js";

test("datas ISO são interpretadas no mês local correto", () => {
  assert.equal(parseLocalDate("2026-08-01").getMonth(), 7);
});

test("ciclo personalizado atravessa a virada do mês", () => {
  const range = getCycleRange(10, 0, new Date(2026, 7, 24, 12));
  assert.equal(range.startISO, "2026-08-10");
  assert.equal(range.endISO, "2026-09-09");
});

test("repetição mensal preserva o último dia possível", () => {
  assert.equal(addMonthsToISO("2026-01-31", 1), "2026-02-28");
});

test("valor livre reserva orçamento ainda não comprometido", () => {
  const categoryId = "moradia";
  const result = computeCycleData({
    cycleStartDay: 1,
    referenceDate: new Date(2026, 7, 24, 12),
    transactions: [
      { type: "income", amount: 5000, date: "2026-08-05", status: "paid", categoryId: "salario" },
      { type: "expense", amount: 1500, date: "2026-08-08", status: "paid", categoryId },
      { type: "expense", amount: 300, date: "2026-08-25", status: "pending", categoryId }
    ],
    budgets: [
      { amount: 2000, cycleKey: "2026-08-01", categoryId },
      { amount: 1000, cycleKey: "2026-08-01", categoryId: "alimentacao" }
    ]
  });
  assert.equal(result.safeToSpend, 2000);
  assert.equal(result.realizedResult, 3500);
  assert.equal(result.budgetSpent, 1800);
});

test("backup antigo é normalizado sem aceitar valores inválidos", () => {
  const backup = normalizeBackup({
    settings: { cycleStartDay: 35 },
    transactions: [
      { id: "1", desc: "Aluguel", amount: "1200", date: "2026-08-01", category: "Moradia" },
      { id: "2", desc: "Inválido", amount: -5, date: "2026-08-01" }
    ]
  });
  assert.equal(backup.settings.cycleStartDay, 28);
  assert.equal(backup.transactions.length, 1);
  assert.equal(backup.transactions[0].externalKey, "local:1");
});
