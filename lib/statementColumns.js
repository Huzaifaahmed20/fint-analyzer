// Column-aware statement parsing.
//
// Preferred over the text-heuristic parser in lib/statement.js whenever the PDF
// has a real "Date / Details / Debit / Credit / Balance" header row: the x
// position of an amount then tells us whether it is a debit, a credit or the
// running balance, which is unambiguous. Text alone is not - the same
// "2,875.00" appears as both a debit and a credit on a DIB statement and only
// its column distinguishes them.

const MONEY_ITEM = /^\(?-?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?(?:\s*(?:CR|DR))?$/i;
const DATE_ITEM = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})$/;

// Carried-balance rows: real transactions, but not spending.
const CARRIED_BALANCE = /brought\s*forward|carried\s*forward|opening\s*balance|closing\s*balance|balance\s*b\/f|balance\s*c\/f/i;

// A detail line belongs to a transaction only if its baseline is this close to
// the transaction's own line. Real wrapped details sit within a few units;
// page footers and legal boilerplate are far away.
const DETAIL_MAX_DY = 22;

function detectColumns(line) {
  const at = (re) => line.items.find((i) => re.test(i.str.trim()));
  const debit = at(/^debit$/i);
  const credit = at(/^credit$/i);
  const balance = at(/^balance$/i);
  if (!debit || !credit || !balance) return null;
  const date = at(/^date$/i);
  return { date: date ? date.x : 0, debit: debit.x, credit: credit.x, balance: balance.x };
}

function toNumber(str) {
  const cleaned = str.trim().replace(/\s*(CR|DR)\s*$/i, '').replace(/,/g, '');
  const negated = /^\(.*\)$/.test(cleaned);
  const n = parseFloat(cleaned.replace(/[()]/g, ''));
  if (Number.isNaN(n)) return null;
  return negated ? -n : n;
}

// Amounts are right-aligned near their header, so nearest-header wins.
function columnOf(x, columns) {
  const candidates = [
    ['debit', Math.abs(x - columns.debit)],
    ['credit', Math.abs(x - columns.credit)],
    ['balance', Math.abs(x - columns.balance)],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

function parseStatementPages(pages, parseDate) {
  const rows = [];
  const errors = [];
  let columns = null;
  let prevBalance = null;
  let checked = 0;
  let mismatched = 0;

  for (const page of pages) {
    const headerLine = page.lines.find((l) => detectColumns(l));
    if (headerLine) columns = detectColumns(headerLine);
    if (!columns) continue;

    const headerY = headerLine ? headerLine.y : Infinity;
    const body = page.lines.filter((l) => l.y < headerY);

    // Pass 1: find the transaction lines (a date in the date column plus at
    // least one amount).
    const anchors = [];
    for (const line of body) {
      const dateItem = line.items.find(
        (i) => DATE_ITEM.test(i.str.trim()) && i.x < columns.debit - 100
      );
      if (!dateItem) continue;
      const money = line.items.filter((i) => MONEY_ITEM.test(i.str.trim()));
      if (money.length === 0) continue;
      anchors.push({ line, dateItem, money, details: [] });
    }
    if (anchors.length === 0) continue;

    // Pass 2: attach each free-standing detail line to its nearest transaction.
    const detailsMinX = 55;
    const detailsMaxX = columns.debit - 20;
    for (const line of body) {
      if (anchors.some((a) => a.line === line)) continue;
      const text = line.items
        .filter((i) => i.x >= detailsMinX && i.x <= detailsMaxX)
        .map((i) => i.str.trim())
        .filter(Boolean)
        .join(' ');
      if (!text) continue;

      let best = null;
      for (const a of anchors) {
        const dy = Math.abs(a.line.y - line.y);
        if (dy <= DETAIL_MAX_DY && (!best || dy < best.dy)) best = { anchor: a, dy };
      }
      if (best) best.anchor.details.push({ y: line.y, text });
    }

    // Pass 3: build rows.
    for (const anchor of anchors) {
      const buckets = { debit: null, credit: null, balance: null };
      for (const item of anchor.money) {
        const col = columnOf(item.x, columns);
        const value = toNumber(item.str);
        if (value !== null && buckets[col] === null) buckets[col] = value;
      }

      let reconciled = true;
      if (buckets.balance !== null) {
        // Reconcile against the running balance to catch rows we failed to read.
        if (prevBalance !== null && (buckets.debit !== null || buckets.credit !== null)) {
          const delta = (buckets.credit || 0) - (buckets.debit || 0);
          checked += 1;
          if (Math.abs(prevBalance + delta - buckets.balance) > 0.01) {
            mismatched += 1;
            reconciled = false;
          }
        }
        prevBalance = buckets.balance;
      }

      // A line with only a balance is a carried-forward marker, not a transaction.
      if (buckets.debit === null && buckets.credit === null) continue;

      const inlineDetails = anchor.line.items
        .filter((i) => i !== anchor.dateItem && !MONEY_ITEM.test(i.str.trim()) && i.x >= detailsMinX)
        .map((i) => i.str.trim());

      const description = [
        ...anchor.details.sort((a, b) => b.y - a.y).map((d) => d.text),
        ...inlineDetails,
      ].join(' ').replace(/\s+/g, ' ').trim();

      if (CARRIED_BALANCE.test(description)) continue;

      let date;
      try {
        date = parseDate(anchor.dateItem.str.trim());
      } catch (err) {
        errors.push({ row: 0, message: `${err.message}` });
        continue;
      }

      const amount = buckets.credit !== null ? Math.abs(buckets.credit) : -Math.abs(buckets.debit);
      if (amount === 0) continue;

      rows.push({ date, description: description || '(no details)', amount, reconciled });
    }
  }

  return { rows, errors, reconciliation: { checked, mismatched } };
}

module.exports = { parseStatementPages, detectColumns, columnOf, MONEY_ITEM, DATE_ITEM };
