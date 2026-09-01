// Warn once spend reaches this fraction of a category's budget.
const WARN_AT = 0.8;

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

// Categories the user has marked as not real spending (transfers between their
// own accounts, typically). They still show in the breakdown, but are kept out
// of the headline total and the trend.
function nonSpendCategories(db) {
  return db
    .prepare('SELECT category FROM category_settings WHERE counts_as_spend = 0')
    .all()
    .map((r) => r.category);
}

// How far through the month we are. A past month is fully elapsed; a future one
// has not started. Used to tell "over budget" from "spending too fast".
function monthPace(monthStr, now = new Date()) {
  const [year, month] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const thisMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  let dayOfMonth;
  if (monthStr === thisMonth) dayOfMonth = now.getDate();
  else if (monthStr < thisMonth) dayOfMonth = daysInMonth;
  else dayOfMonth = 0;

  return { dayOfMonth, daysInMonth, elapsed: dayOfMonth / daysInMonth };
}

function spendForRange(db, start, end, excluded = []) {
  const filter = excluded.length ? ` AND category NOT IN (${excluded.map(() => '?').join(', ')})` : '';
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(-amount), 0) AS total FROM transactions
       WHERE amount < 0 AND date >= ? AND date < ?${filter}`
    )
    .get(start, end, ...excluded);
  return row.total;
}

// Every month present in the data, with what was spent and received. Drives the
// "Monthly Spend" card so all months are visible at once, not one at a time.
function monthlyTotals(db) {
  const excluded = nonSpendCategories(db);
  const notExcluded = excluded.length
    ? `AND category NOT IN (${excluded.map(() => '?').join(', ')})`
    : '';

  return db
    .prepare(
      `SELECT substr(date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN amount < 0 ${notExcluded} THEN -amount ELSE 0 END), 0) AS spend,
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS income,
              COUNT(*) AS count
       FROM transactions
       GROUP BY month
       ORDER BY month DESC`
    )
    .all(...excluded);
}

function buildSummary(db, month, now = new Date()) {
  const { start, end } = monthRange(month);
  const excluded = nonSpendCategories(db);
  const pace = monthPace(month, now);

  const totalSpend = spendForRange(db, start, end, excluded);

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
    const overrun = budget !== null && row.amount > budget;
    const used = budget ? row.amount / budget : 0;

    return {
      category: row.category,
      amount: row.amount,
      budget,
      overrun,
      // Approaching the limit but not past it yet.
      warning: budget !== null && !overrun && row.amount >= budget * WARN_AT,
      // Spending faster than the month is passing.
      aheadOfPace: budget !== null && !overrun && pace.elapsed > 0 && used > pace.elapsed,
      countsAsSpend: !excluded.includes(row.category),
    };
  });

  const trend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const m = shiftMonth(month, -i);
    const range = monthRange(m);
    trend.push({ month: m, total: spendForRange(db, range.start, range.end, excluded) });
  }

  return { month, totalSpend, byCategory, trend, pace, excludedCategories: excluded };
}

module.exports = { monthRange, currentMonth, shiftMonth, monthPace, monthlyTotals, buildSummary, WARN_AT };
