// Turns extracted PDF text lines into the canonical {date, description, amount}
// shape used by the rest of the import pipeline.
//
// Unlike CSV, a statement PDF has no headers to key off, so this works by
// structure: a transaction line starts with a date and ends with one or more
// money amounts. See STATEMENT-LAYOUT ASSUMPTIONS below - these are heuristics
// and are expected to need tuning against a real statement.

const { parseDate, parseAmount } = require('./importer');

// A transaction row begins with a date in one of the formats parseDate accepts.
const DATE_AT_START = /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/;

// Money requires exactly two decimals, so reference numbers, card digits and
// dates are not mistaken for amounts.
const MONEY = /\(?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?(?:\s*(?:CR|DR))?/gi;

// Lines that look like transactions but are running totals or page furniture.
const NOT_A_TRANSACTION = /(opening|closing)\s+balance|balance\s+(b\/f|c\/f|brought\s+forward|carried\s+forward)|^\s*page\s+\d/i;

function tokenValue(raw) {
  const marker = /CR/i.test(raw) ? 'CR' : /DR/i.test(raw) ? 'DR' : null;
  const numeric = raw.replace(/\s*(CR|DR)\s*$/i, '');
  return { value: parseAmount(numeric), marker, raw };
}

// Decide the sign of a transaction under the app's signed-amount convention
// (negative = money out). Explicit CR/DR markers win; otherwise the running
// balance tells us the direction; otherwise assume an expense.
function signedAmount(token, prevBalance, balance) {
  const magnitude = Math.abs(token.value);

  if (token.marker === 'CR') return magnitude;
  if (token.marker === 'DR') return -magnitude;
  if (token.value < 0) return -magnitude;

  if (prevBalance !== null && balance !== null) {
    const delta = balance - prevBalance;
    if (Math.abs(Math.abs(delta) - magnitude) < 0.005) {
      return delta > 0 ? magnitude : -magnitude;
    }
  }

  return -magnitude;
}

// lines: array of strings, or of {text} objects as produced by lib/pdf.js
function parseStatementRows(lines) {
  const rows = [];
  const errors = [];
  let prevBalance = null;

  lines.forEach((line, index) => {
    const text = (typeof line === 'string' ? line : line.text || '').trim();
    if (!text) return;

    const money = [...text.matchAll(MONEY)].map((m) => ({ raw: m[0], index: m.index }));
    const dateMatch = text.match(DATE_AT_START);

    if (!dateMatch) {
      // A wrapped description continues the previous transaction. Only treat it
      // as such if it carries no amounts of its own.
      if (rows.length > 0 && money.length === 0 && text.length <= 80) {
        const last = rows[rows.length - 1];
        last.description = `${last.description} ${text}`.replace(/\s+/g, ' ').trim();
      }
      return;
    }

    if (NOT_A_TRANSACTION.test(text)) {
      // Still useful: an opening balance seeds the running balance so the very
      // first real row can have its direction inferred.
      if (money.length > 0) prevBalance = tokenValue(money[money.length - 1].raw).value;
      return;
    }

    if (money.length === 0) return;

    let date;
    try {
      date = parseDate(dateMatch[1]);
    } catch (err) {
      errors.push({ row: index + 1, message: err.message });
      return;
    }

    const values = money.map((m) => tokenValue(m.raw));
    let amount;
    let balance = null;

    if (values.length === 1) {
      amount = signedAmount(values[0], null, null);
    } else {
      balance = values[values.length - 1].value;
      amount = signedAmount(values[values.length - 2], prevBalance, balance);
    }

    const description = text
      .slice(dateMatch[0].length, money[0].index)
      .replace(/\s+/g, ' ')
      .trim();

    if (!description) {
      errors.push({ row: index + 1, message: 'missing description' });
      return;
    }
    if (amount === 0) {
      errors.push({ row: index + 1, message: 'zero or unparseable amount' });
      return;
    }

    rows.push({ date, description, amount });
    if (balance !== null) prevBalance = balance;
  });

  return { rows, errors };
}

module.exports = { parseStatementRows, signedAmount, DATE_AT_START, MONEY };
