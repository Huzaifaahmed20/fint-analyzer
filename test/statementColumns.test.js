const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStatementPages } = require('../lib/statementColumns');
const { parseDate } = require('../lib/importer');

// Mirrors the real DIB geometry: Date 41.8, Details 189.7, Debit 353.6,
// Credit 439.6, Balance 531.1, with values right-aligned near their header.
function line(y, items) {
  return {
    y,
    items: items.map(([x, str]) => ({ x, y, str, width: str.length * 5 })),
    text: items.map(([, str]) => str).join(' '),
  };
}
const HEADER = line(476, [[41.8, 'Date'], [189.7, 'Details'], [353.6, 'Debit'], [439.6, 'Credit'], [531.1, 'Balance']]);

test('column position decides debit vs credit for identical amounts', () => {
  const { rows } = parseStatementPages([{ page: 1, lines: [
    HEADER,
    line(449, [[30.9, '31/07/2026'], [84.3, 'BROUGHT FORWARD'], [524.6, '27,791.20 Cr']]),
    line(413, [[84.3, 'CARD PURCHASE ONE']]),
    line(408, [[29.6, '03/08/2026'], [347.8, '2,875.00'], [523.6, '24,916.20 Cr']]),
    line(372, [[84.3, 'TRANSFER IN']]),
    line(368, [[29.6, '05/08/2026'], [435.2, '2,875.00'], [524.3, '27,791.20 Cr']]),
  ] }], parseDate);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, -2875); // debit column
  assert.equal(rows[1].amount, 2875);  // credit column, same text
});

test('a balance-only line is treated as carried-forward, not a transaction', () => {
  const { rows } = parseStatementPages([{ page: 1, lines: [
    HEADER,
    line(449, [[30.9, '31/07/2026'], [84.3, 'BROUGHT FORWARD'], [524.6, '27,791.20 Cr']]),
  ] }], parseDate);

  assert.equal(rows.length, 0);
});

test('details attach to the nearest transaction line, above or below', () => {
  const { rows } = parseStatementPages([{ page: 1, lines: [
    HEADER,
    line(413, [[84.3, 'DDR-2120000039']]),
    line(408, [[29.6, '03/08/2026'], [347.8, '100.00'], [523.6, '900.00 Cr']]),
    line(403, [[84.3, 'DUBAI ISLAMIC BANK']]),
  ] }], parseDate);

  assert.equal(rows[0].description, 'DDR-2120000039 DUBAI ISLAMIC BANK');
});

test('distant footer text is not absorbed into a description', () => {
  const { rows } = parseStatementPages([{ page: 1, lines: [
    HEADER,
    line(408, [[29.6, '03/08/2026'], [347.8, '100.00'], [523.6, '900.00 Cr']]),
    line(120, [[84.3, 'Head Office PO Box 1080 Dubai legal boilerplate']]),
  ] }], parseDate);

  assert.equal(rows[0].description, '(no details)');
  assert.ok(!rows[0].description.includes('boilerplate'));
});

test('reconciles rows against the running balance and counts mismatches', () => {
  const { reconciliation } = parseStatementPages([{ page: 1, lines: [
    HEADER,
    line(449, [[30.9, '31/07/2026'], [84.3, 'BROUGHT FORWARD'], [524.6, '1,000.00 Cr']]),
    line(408, [[29.6, '03/08/2026'], [347.8, '100.00'], [523.6, '900.00 Cr']]),   // reconciles
    line(368, [[29.6, '04/08/2026'], [347.8, '100.00'], [523.6, '700.00 Cr']]),   // does not
  ] }], parseDate);

  assert.equal(reconciliation.checked, 2);
  assert.equal(reconciliation.mismatched, 1);
});
