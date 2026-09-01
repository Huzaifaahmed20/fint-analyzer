const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'spend-tracker.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
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

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);

  CREATE TABLE IF NOT EXISTS budgets (
    category TEXT PRIMARY KEY,
    monthly_limit REAL NOT NULL
  );

  -- Categories learned from manual recategorization: merchant -> category.
  -- Checked before the keyword rules in config/categories.json.
  CREATE TABLE IF NOT EXISTS merchant_rules (
    merchant TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Per-category behaviour. counts_as_spend = 0 keeps a category out of the
  -- headline spend total (used for transfers between your own accounts).
  CREATE TABLE IF NOT EXISTS category_settings (
    category TEXT PRIMARY KEY,
    counts_as_spend INTEGER NOT NULL DEFAULT 1
  );
`);

// There is no migration framework, so bring older databases up to date by
// adding any column the CREATE TABLE above gained.
const existingColumns = new Set(db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name));
if (!existingColumns.has('merchant')) {
  db.exec("ALTER TABLE transactions ADD COLUMN merchant TEXT NOT NULL DEFAULT ''");
}
if (!existingColumns.has('reconciled')) {
  db.exec('ALTER TABLE transactions ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 1');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant)');

// Backfill merchant names for rows imported before the column existed.
const { cleanMerchant } = require('../lib/merchant');
const needsMerchant = db.prepare("SELECT id, description FROM transactions WHERE merchant = ''").all();
if (needsMerchant.length > 0) {
  const setMerchant = db.prepare('UPDATE transactions SET merchant = ? WHERE id = ?');
  for (const row of needsMerchant) setMerchant.run(cleanMerchant(row.description), row.id);
}

module.exports = db;
