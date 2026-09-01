const crypto = require('node:crypto');
const { parse } = require('csv-parse/sync');

const { cleanMerchant } = require('./merchant');

const DATE_ALIASES = ['date', 'transactiondate', 'valuedate', 'postingdate', 'txndate'];
const DESC_ALIASES = ['description', 'narration', 'particulars', 'details', 'memo', 'transactiondetails', 'remarks'];
const AMOUNT_ALIASES = ['amount', 'transactionamount', 'amt'];
const DEBIT_ALIASES = ['debit', 'withdrawal', 'debitamount', 'withdrawalamount', 'dr'];
const CREDIT_ALIASES = ['credit', 'deposit', 'creditamount', 'depositamount', 'cr'];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function normalizeHeader(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumn(normalizedHeaders, aliases) {
  for (const alias of aliases) {
    const match = normalizedHeaders.find((h) => h.normalized === alias);
    if (match) return match.original;
  }
  return null;
}

function detectColumns(headers) {
  const normalizedHeaders = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }));

  const dateCol = findColumn(normalizedHeaders, DATE_ALIASES);
  const descCol = findColumn(normalizedHeaders, DESC_ALIASES);
  const amountCol = findColumn(normalizedHeaders, AMOUNT_ALIASES);
  const debitCol = findColumn(normalizedHeaders, DEBIT_ALIASES);
  const creditCol = findColumn(normalizedHeaders, CREDIT_ALIASES);

  if (!dateCol) throw new Error('Could not detect a date column');
  if (!descCol) throw new Error('Could not detect a description column');
  if (!amountCol && !(debitCol && creditCol)) {
    throw new Error('Could not detect an amount column (need "Amount", or both "Debit" and "Credit")');
  }

  return { dateCol, descCol, amountCol, debitCol, creditCol };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDate(raw) {
  const str = String(raw).trim();

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = str.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Day-first: DD/MM/YYYY or DD-MM-YYYY (matches Emirates NBD / UAE bank exports)
  m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, day, month, year] = m;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  m = str.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const [, day, monthName, year] = m;
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (!month) throw new Error(`Unrecognized month in date: ${raw}`);
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  throw new Error(`Unrecognized date format: ${raw}`);
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim();
  if (s === '') return 0;

  s = s.replace(/[, ]/g, '').replace(/AED|USD|EUR|GBP|\$/gi, '');

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  const num = parseFloat(s);
  if (Number.isNaN(num)) return 0;
  return negative ? -num : num;
}

// amount is signed here: negative = money out (expense), positive = money in (income)
function hashTransaction({ date, description, amount }) {
  return crypto
    .createHash('sha256')
    .update(`${date}|${description.trim().toLowerCase()}|${amount.toFixed(2)}`)
    .digest('hex');
}

function normalizeRows(rawRows, columns) {
  const normalized = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowNum = index + 2; // +1 for header row, +1 for 1-based indexing
    try {
      const date = parseDate(row[columns.dateCol]);
      const description = String(row[columns.descCol] || '').trim();
      if (!description) throw new Error('missing description');

      let amount;
      if (columns.amountCol) {
        amount = parseAmount(row[columns.amountCol]);
        if (amount === 0) throw new Error('zero or unparseable amount');
      } else {
        const debit = parseAmount(row[columns.debitCol]);
        const credit = parseAmount(row[columns.creditCol]);
        if (debit === 0 && credit === 0) throw new Error('no debit or credit amount');
        amount = credit !== 0 ? Math.abs(credit) : -Math.abs(debit);
      }

      normalized.push({ date, description, amount });
    } catch (err) {
      errors.push({ row: rowNum, message: err.message });
    }
  });

  return { normalized, errors };
}

// Hash, dedupe, categorize and insert already-normalized rows. Shared by the
// CSV and PDF import paths so both get identical duplicate detection.
function persistRows(normalized, db, categorize) {
  const insert = db.prepare(
    `INSERT INTO transactions (date, description, amount, category, merchant, reconciled, hash, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const checkExists = db.prepare('SELECT 1 FROM transactions WHERE hash = ?');

  let imported = 0;
  let duplicates = 0;
  const importedAt = new Date().toISOString();

  for (const tx of normalized) {
    const hash = hashTransaction(tx);
    if (checkExists.get(hash)) {
      duplicates += 1;
      continue;
    }
    const merchant = cleanMerchant(tx.description);
    const category = categorize(tx.description, tx.amount, merchant);
    insert.run(
      tx.date, tx.description, tx.amount, category, merchant,
      tx.reconciled === false ? 0 : 1, hash, importedAt
    );
    imported += 1;
  }

  return { imported, duplicates };
}

// categorize: (description, amount) => categoryName
function importCsv(buffer, db, categorize) {
  const rawRows = parse(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });

  if (rawRows.length === 0) {
    return { imported: 0, duplicates: 0, errors: [{ row: 0, message: 'CSV has no data rows' }] };
  }

  const columns = detectColumns(Object.keys(rawRows[0]));
  const { normalized, errors } = normalizeRows(rawRows, columns);

  return { ...persistRows(normalized, db, categorize), errors };
}

module.exports = {
  detectColumns,
  persistRows,
  parseDate,
  parseAmount,
  hashTransaction,
  normalizeRows,
  importCsv,
};
