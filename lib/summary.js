function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthRange(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const start = `${monthStr}-01`;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const end = `${nextMonth.year}-${pad2(nextMonth.month)}-01`;
  return { start, end };
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function shiftMonth(monthStr, delta) {
  let [year, month] = monthStr.split('-').map(Number);
  month += delta;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${pad2(month)}`;
}

function spendForRange(db, start, end) {
  const row = db
    .prepare('SELECT COALESCE(SUM(-amount), 0) AS total FROM transactions WHERE amount < 0 AND date >= ? AND date < ?')
    .get(start, end);
  return row.total;
}

function buildSummary(db, month) {
  const { start, end } = monthRange(month);

  const totalSpend = spendForRange(db, start, end);

  const byCategoryRows = db
    .prepare(
      `SELECT category, SUM(-amount) AS amount FROM transactions
       WHERE amount < 0 AND date >= ? AND date < ?
       GROUP BY category ORDER BY amount DESC`
    )
    .all(start, end);

  const budgetRows = db.prepare('SELECT category, monthly_limit FROM budgets').all();
  const budgetMap = new Map(budgetRows.map((b) => [b.category, b.monthly_limit]));

  const byCategory = byCategoryRows.map((row) => {
    const budget = budgetMap.has(row.category) ? budgetMap.get(row.category) : null;
    return {
      category: row.category,
      amount: row.amount,
      budget,
      overrun: budget !== null && row.amount > budget,
    };
  });

  const trend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const m = shiftMonth(month, -i);
    const range = monthRange(m);
    trend.push({ month: m, total: spendForRange(db, range.start, range.end) });
  }

  return { month, totalSpend, byCategory, trend };
}

module.exports = { monthRange, currentMonth, shiftMonth, buildSummary };
