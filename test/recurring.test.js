const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { findRecurring } = require('../lib/recurring');

function makeDb(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL,
      category TEXT NOT NULL, merchant TEXT NOT NULL DEFAULT '',
      reconciled INTEGER NOT NULL DEFAULT 1,
      hash TEXT NOT NULL UNIQUE, imported_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    'INSERT INTO transactions (date, description, amount, category, merchant, hash, imported_at) VALUES (?,?,?,?,?,?,?)'
  );
  rows.forEach(([date, merchant, amount], i) => insert.run(date, merchant, amount, 'X', merchant, `h${i}`, 'now'));
  return db;
}

test('finds merchants charging across two or more months', () => {
  const { items } = findRecurring(makeDb([
    ['2026-07-05', 'Dropbox', -47.7],
    ['2026-08-05', 'Dropbox', -47.7],
    ['2026-08-06', 'ONE OFF SHOP', -20],
  ]));

  assert.equal(items.length, 1);
  assert.equal(items[0].merchant, 'Dropbox');
  assert.equal(items[0].months, 2);
});

test('flags a steady amount as subscription-like and a varying one as not', () => {
  const { items } = findRecurring(makeDb([
    ['2026-07-05', 'Dropbox', -47.7], ['2026-08-05', 'Dropbox', -47.7],
    ['2026-07-08', 'NESTO', -30], ['2026-08-08', 'NESTO', -180],
  ]));

  const byName = Object.fromEntries(items.map((i) => [i.merchant, i]));
  assert.equal(byName.Dropbox.steady, true);
  assert.equal(byName.NESTO.steady, false);
});

test('reports how many months of data exist so the UI can explain itself', () => {
  const { items, monthsOfData } = findRecurring(makeDb([['2026-08-05', 'Dropbox', -47.7]]));
  assert.equal(monthsOfData, 1);
  assert.equal(items.length, 0);
});

test('ignores income when looking for recurring charges', () => {
  const { items } = findRecurring(makeDb([
    ['2026-07-25', 'ACME PAYROLL', 5000],
    ['2026-08-25', 'ACME PAYROLL', 5000],
  ]));
  assert.equal(items.length, 0);
});
