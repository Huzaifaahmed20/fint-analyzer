const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { detectColumns, parseDate, parseAmount, hashTransaction, importCsv } = require('../lib/importer');

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
  `);
  return db;
}

const categorize = () => 'Uncategorized';

test('detectColumns finds Amount-style headers', () => {
  const cols = detectColumns(['Date', 'Description', 'Amount']);
  assert.equal(cols.dateCol, 'Date');
  assert.equal(cols.descCol, 'Description');
  assert.equal(cols.amountCol, 'Amount');
});

test('detectColumns finds Debit/Credit-style headers', () => {
  const cols = detectColumns(['Value Date', 'Narration', 'Debit', 'Credit']);
  assert.equal(cols.dateCol, 'Value Date');
  assert.equal(cols.descCol, 'Narration');
  assert.equal(cols.debitCol, 'Debit');
  assert.equal(cols.creditCol, 'Credit');
});

test('detectColumns throws when no recognizable headers are present', () => {
  assert.throws(() => detectColumns(['Foo', 'Bar']));
});

test('parseDate handles ISO, day-first, and textual-month formats', () => {
  assert.equal(parseDate('2026-01-05'), '2026-01-05');
  assert.equal(parseDate('05/01/2026'), '2026-01-05');
  assert.equal(parseDate('5 Jan 2026'), '2026-01-05');
});

test('parseAmount handles signs, currency labels, commas, and parentheses', () => {
  assert.equal(parseAmount('-120.50'), -120.5);
  assert.equal(parseAmount('AED 1,250.00'), 1250);
  assert.equal(parseAmount('(75.00)'), -75);
  assert.equal(parseAmount(''), 0);
});

test('hashTransaction is stable for identical input', () => {
  const tx = { date: '2026-01-05', description: 'Carrefour', amount: -120.5 };
  assert.equal(hashTransaction(tx), hashTransaction({ ...tx }));
});

test('importCsv imports rows and skips duplicates on re-import', () => {
  const db = makeDb();
  const csv = 'Date,Description,Amount\n2026-01-05,Carrefour Mall,-120.50\n2026-01-06,Salary,5000\n';

  const first = importCsv(Buffer.from(csv), db, categorize);
  assert.equal(first.imported, 2);
  assert.equal(first.duplicates, 0);

  const second = importCsv(Buffer.from(csv), db, categorize);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 2);

  const rows = db.prepare('SELECT * FROM transactions').all();
  assert.equal(rows.length, 2);
});

test('importCsv supports Debit/Credit columns and reports bad rows as errors', () => {
  const db = makeDb();
  const csv =
    'Value Date,Narration,Debit,Credit\n' +
    '05/01/2026,Spinneys,45.00,\n' +
    '06/01/2026,Salary Credit,,5000.00\n' +
    '07/01/2026,,,\n';

  const result = importCsv(Buffer.from(csv), db, categorize);
  assert.equal(result.imported, 2);
  assert.equal(result.errors.length, 1);

  const rows = db.prepare('SELECT * FROM transactions ORDER BY date').all();
  assert.equal(rows[0].amount, -45);
  assert.equal(rows[1].amount, 5000);
});
