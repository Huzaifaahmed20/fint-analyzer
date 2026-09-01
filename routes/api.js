const express = require('express');
const multer = require('multer');

const db = require('../db');
const categoryRules = require('../config/categories.json');
const { categorize } = require('../lib/categorizer');
const { importCsv } = require('../lib/importer');
const { importPdf, PdfPasswordError } = require('../lib/pdfImporter');
const { buildSummary, currentMonth, monthRange, monthlyTotals } = require('../lib/summary');
const { findRecurring } = require('../lib/recurring');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const KNOWN_CATEGORIES = [...Object.keys(categoryRules), 'Uncategorized'];

const router = express.Router();

// Rules learned from manual recategorization beat the keyword rules, so a
// correction the user made once is never undone by a later import.
function makeCategorizer() {
  const learned = new Map(
    db.prepare('SELECT merchant, category FROM merchant_rules').all().map((r) => [r.merchant, r.category])
  );
  return (description, amount, merchant) =>
    learned.get(merchant) || categorize(description, amount, categoryRules);
}

function isPdf(file) {
  return file.mimetype === 'application/pdf'
    || /\.pdf$/i.test(file.originalname || '')
    || file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected multipart field "file")' });
  }

  const categorizeFn = makeCategorizer();

  try {
    const result = isPdf(req.file)
      ? await importPdf(req.file.buffer, db, categorizeFn, process.env.PDF_PASSWORD)
      : importCsv(req.file.buffer, db, categorizeFn);
    return res.json(result);
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(400).json({ error: err.message });
  }
});

function transactionFilters(query) {
  const { month, category, search, merchant, unreconciled } = query;
  const clauses = [];
  const params = [];

  if (month) {
    const { start, end } = monthRange(month);
    clauses.push('date >= ? AND date < ?');
    params.push(start, end);
  }
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (merchant) {
    clauses.push('merchant = ?');
    params.push(merchant);
  }
  if (unreconciled === 'true') clauses.push('reconciled = 0');
  if (search) {
    clauses.push('(LOWER(description) LIKE ? OR LOWER(merchant) LIKE ?)');
    params.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

router.get('/transactions', (req, res) => {
  const { where, params } = transactionFilters(req.query);
  const rows = db.prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, id DESC`).all(...params);
  res.json(rows);
});

router.patch('/transactions/:id', (req, res) => {
  const { category, applyToMerchant } = req.body || {};
  if (!category || typeof category !== 'string') {
    return res.status(400).json({ error: 'category is required' });
  }

  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });

  db.prepare('UPDATE transactions SET category = ? WHERE id = ?').run(category, req.params.id);

  let applied = 1;
  if (applyToMerchant && existing.merchant) {
    applied = db
      .prepare('UPDATE transactions SET category = ? WHERE merchant = ?')
      .run(category, existing.merchant).changes;
    db.prepare(
      `INSERT INTO merchant_rules (merchant, category, created_at) VALUES (?, ?, ?)
       ON CONFLICT(merchant) DO UPDATE SET category = excluded.category`
    ).run(existing.merchant, category, new Date().toISOString());
  }

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  return res.json({ ...row, applied, merchant: existing.merchant });
});

// Re-run categorization over existing rows. Only touches Uncategorized rows
// unless explicitly told otherwise, so manual choices survive a rule change.
router.post('/recategorize', (req, res) => {
  const includeCategorized = Boolean((req.body || {}).includeCategorized);
  const categorizeFn = makeCategorizer();

  const where = includeCategorized ? '' : " WHERE category = 'Uncategorized'";
  const rows = db.prepare(`SELECT id, description, amount, merchant, category FROM transactions${where}`).all();
  const update = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');

  let changed = 0;
  for (const row of rows) {
    const next = categorizeFn(row.description, row.amount, row.merchant);
    if (next !== row.category) {
      update.run(next, row.id);
      changed += 1;
    }
  }

  res.json({ examined: rows.length, changed });
});

router.get('/months', (_req, res) => {
  res.json(monthlyTotals(db));
});

router.get('/recurring', (_req, res) => {
  res.json(findRecurring(db));
});

router.get('/merchant-rules', (_req, res) => {
  res.json(db.prepare('SELECT merchant, category FROM merchant_rules ORDER BY merchant').all());
});

router.delete('/merchant-rules/:merchant', (req, res) => {
  db.prepare('DELETE FROM merchant_rules WHERE merchant = ?').run(req.params.merchant);
  res.status(204).end();
});

router.get('/categories', (_req, res) => {
  const budgets = db.prepare('SELECT category, monthly_limit FROM budgets').all();
  const settings = db.prepare('SELECT category, counts_as_spend FROM category_settings').all();
  res.json({ categories: KNOWN_CATEGORIES, budgets, settings });
});

router.put('/category-settings/:category', (req, res) => {
  const countsAsSpend = (req.body || {}).counts_as_spend ? 1 : 0;
  db.prepare(
    `INSERT INTO category_settings (category, counts_as_spend) VALUES (?, ?)
     ON CONFLICT(category) DO UPDATE SET counts_as_spend = excluded.counts_as_spend`
  ).run(req.params.category, countsAsSpend);
  res.json({ category: req.params.category, counts_as_spend: countsAsSpend });
});

router.put('/budgets/:category', (req, res) => {
  const { monthly_limit: monthlyLimit } = req.body || {};
  const value = Number(monthlyLimit);
  if (!Number.isFinite(value) || value < 0) {
    return res.status(400).json({ error: 'monthly_limit must be a non-negative number' });
  }

  db.prepare(
    `INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit`
  ).run(req.params.category, value);

  res.json({ category: req.params.category, monthly_limit: value });
});

router.delete('/budgets/:category', (req, res) => {
  db.prepare('DELETE FROM budgets WHERE category = ?').run(req.params.category);
  res.status(204).end();
});

router.get('/summary', (req, res) => {
  const month = req.query.month || currentMonth();
  res.json(buildSummary(db, month));
});

router.get('/export', (req, res) => {
  const { where, params } = transactionFilters(req.query);
  const rows = db
    .prepare(`SELECT date, description, merchant, category, amount FROM transactions ${where} ORDER BY date, id`)
    .all(...params);

  const quote = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = ['Date,Description,Merchant,Category,Amount']
    .concat(rows.map((r) => [r.date, quote(r.description), quote(r.merchant), quote(r.category), r.amount].join(',')))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spend-${req.query.month || 'all'}.csv"`);
  res.send(`${csv}\n`);
});

module.exports = router;
