// Detects merchants that charge you every month - subscriptions, utilities,
// instalments - so a fixed monthly outflow can be separated from one-off spend.

// A merchant must appear in at least this many distinct months to count.
const MIN_MONTHS = 2;

function findRecurring(db, { minMonths = MIN_MONTHS } = {}) {
  const rows = db
    .prepare(
      `SELECT merchant, substr(date, 1, 7) AS month, SUM(-amount) AS total, COUNT(*) AS n
       FROM transactions
       WHERE amount < 0 AND merchant <> ''
       GROUP BY merchant, month`
    )
    .all();

  const monthsOfData = new Set(rows.map((r) => r.month)).size;

  const byMerchant = new Map();
  for (const row of rows) {
    if (!byMerchant.has(row.merchant)) byMerchant.set(row.merchant, []);
    byMerchant.get(row.merchant).push(row);
  }

  const items = [];
  for (const [merchant, months] of byMerchant) {
    if (months.length < minMonths) continue;

    const totals = months.map((m) => m.total);
    const average = totals.reduce((a, b) => a + b, 0) / totals.length;
    const spread = Math.max(...totals) - Math.min(...totals);

    items.push({
      merchant,
      months: months.length,
      average,
      lastMonth: months.map((m) => m.month).sort().pop(),
      lastAmount: months.slice().sort((a, b) => a.month.localeCompare(b.month)).pop().total,
      // A steady amount looks like a subscription; a varying one is a habit.
      steady: average > 0 && spread / average < 0.15,
    });
  }

  items.sort((a, b) => b.average - a.average);

  return {
    items,
    monthsOfData,
    monthlyTotal: items.reduce((sum, i) => sum + i.average, 0),
  };
}

module.exports = { findRecurring, MIN_MONTHS };
