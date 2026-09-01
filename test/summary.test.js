const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { monthRange, shiftMonth, buildSummary, monthlyTotals } = require('../lib/summary');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      merchant TEXT NOT NULL DEFAULT '',
      reconciled INTEGER NOT NULL DEFAULT 1,
      hash TEXT NOT NULL UNIQUE,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE budgets (
      category TEXT PRIMARY KEY,
      monthly_limit REAL NOT NULL
    );
    CREATE TABLE category_settings (
      category TEXT PRIMARY KEY,
      counts_as_spend INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

test('monthRange computes correct boundaries across a year wrap', () => {
  assert.deepEqual(monthRange('2025-12'), { start: '2025-12-01', end: '2026-01-01' });
});

test('shiftMonth wraps years in both directions', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
});

test('buildSummary aggregates spend, budgets, and trend', () => {
  const db = makeDb();
  const insert = db.prepare(
    'INSERT INTO transactions (date, description, amount, category, hash, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('2026-01-05', 'Carrefour', -100, 'Groceries', 'h1', 'now');
  insert.run('2026-01-10', 'Spinneys', -50, 'Groceries', 'h2', 'now');
  insert.run('2026-01-12', 'Salary', 5000, 'Income', 'h3', 'now');
  db.prepare('INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)').run('Groceries', 100);

  const summary = buildSummary(db, '2026-01');

  assert.equal(summary.totalSpend, 150);
  assert.equal(summary.byCategory.length, 1);
  assert.equal(summary.byCategory[0].category, 'Groceries');
  assert.equal(summary.byCategory[0].overrun, true);
  assert.equal(summary.trend.length, 6);
  assert.equal(summary.trend[5].month, '2026-01');
  assert.equal(summary.trend[5].total, 150);
});

test('categories marked as non-spend are excluded from the total but still listed', () => {
  const db = makeDb();
  const insert = db.prepare(
    'INSERT INTO transactions (date, description, amount, category, hash, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('2026-01-05', 'Carrefour', -100, 'Groceries', 'h1', 'now');
  insert.run('2026-01-06', 'To savings', -900, 'Transfers', 'h2', 'now');
  db.prepare('INSERT INTO category_settings (category, counts_as_spend) VALUES (?, ?)').run('Transfers', 0);

  const summary = buildSummary(db, '2026-01', new Date('2026-02-15T12:00:00Z'));

  assert.equal(summary.totalSpend, 100);
  assert.deepEqual(summary.excludedCategories, ['Transfers']);
  assert.equal(summary.byCategory.length, 2);
  assert.equal(summary.byCategory.find((c) => c.category === 'Transfers').countsAsSpend, false);
  assert.equal(summary.trend[5].total, 100);
});

test('warns when spend passes 80% of budget without exceeding it', () => {
  const db = makeDb();
  db.prepare(
    'INSERT INTO transactions (date, description, amount, category, hash, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('2026-01-05', 'Carrefour', -850, 'Groceries', 'h1', 'now');
  db.prepare('INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)').run('Groceries', 1000);

  const row = buildSummary(db, '2026-01', new Date('2026-02-15T12:00:00Z')).byCategory[0];
  assert.equal(row.warning, true);
  assert.equal(row.overrun, false);
});

test('flags spending faster than the month is elapsing', () => {
  const db = makeDb();
  db.prepare(
    'INSERT INTO transactions (date, description, amount, category, hash, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('2026-01-05', 'Carrefour', -500, 'Groceries', 'h1', 'now');
  db.prepare('INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)').run('Groceries', 1000);

  // 5 January: 16% through the month, 50% of the budget spent.
  const row = buildSummary(db, '2026-01', new Date('2026-01-05T12:00:00Z')).byCategory[0];
  assert.equal(row.aheadOfPace, true);
  assert.equal(row.overrun, false);
});

test('monthlyTotals reports every month newest first, honouring exclusions', () => {
  const db = makeDb();
  const insert = db.prepare(
    'INSERT INTO transactions (date, description, amount, category, hash, imported_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insert.run('2025-12-05', 'Carrefour', -100, 'Groceries', 'h1', 'now');
  insert.run('2026-01-06', 'Spinneys', -60, 'Groceries', 'h2', 'now');
  insert.run('2026-01-07', 'To savings', -900, 'Transfers', 'h3', 'now');
  insert.run('2026-01-25', 'Salary', 5000, 'Income', 'h4', 'now');
  db.prepare('INSERT INTO category_settings (category, counts_as_spend) VALUES (?, ?)').run('Transfers', 0);

  const months = monthlyTotals(db);

  assert.deepEqual(months.map((m) => m.month), ['2026-01', '2025-12']);
  assert.equal(months[0].spend, 60);      // the 900 transfer is excluded
  assert.equal(months[0].income, 5000);
  assert.equal(months[0].count, 3);
  assert.equal(months[1].spend, 100);
});
