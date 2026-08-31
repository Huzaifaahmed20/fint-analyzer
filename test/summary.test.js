const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { monthRange, shiftMonth, buildSummary } = require('../lib/summary');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      imported_at TEXT NOT NULL
    );
    CREATE TABLE budgets (
      category TEXT PRIMARY KEY,
      monthly_limit REAL NOT NULL
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
