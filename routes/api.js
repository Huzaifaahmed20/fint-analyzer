const express = require('express');
const multer = require('multer');

const db = require('../db');
const categoryRules = require('../config/categories.json');
const { categorize } = require('../lib/categorizer');
const { importCsv } = require('../lib/importer');
const { buildSummary, currentMonth } = require('../lib/summary');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const KNOWN_CATEGORIES = [...Object.keys(categoryRules), 'Uncategorized'];

const router = express.Router();

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected multipart field "file")' });
  }

  try {
    const categorizeFn = (description, amount) => categorize(description, amount, categoryRules);
    const result = importCsv(req.file.buffer, db, categorizeFn);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/transactions', (req, res) => {
  const { month, category, search } = req.query;

  const clauses = [];
  const params = [];

  if (month) {
    clauses.push('date >= ? AND date < ?');
    const [year, mon] = month.split('-').map(Number);
    const start = `${month}-01`;
    const next = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`;
    params.push(start, next);
  }

  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  if (search) {
    clauses.push('LOWER(description) LIKE ?');
    params.push(`%${search.toLowerCase()}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC, id DESC`).all(...params);

  res.json(rows);
});

router.patch('/transactions/:id', (req, res) => {
  const { category } = req.body || {};
  if (!category || typeof category !== 'string') {
    return res.status(400).json({ error: 'category is required' });
  }

  const result = db.prepare('UPDATE transactions SET category = ? WHERE id = ?').run(category, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  return res.json(row);
});

router.get('/categories', (_req, res) => {
  const budgets = db.prepare('SELECT category, monthly_limit FROM budgets').all();
  res.json({ categories: KNOWN_CATEGORIES, budgets });
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

module.exports = router;
