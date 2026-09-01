const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStatementRows } = require('../lib/statement');

test('infers expense/income direction from the running balance', () => {
  const { rows } = parseStatementRows([
    '01/01/2026 OPENING BALANCE 10,000.00',
    '05/01/2026 CARREFOUR HYPERMARKET 120.50 9,879.50',
    '06/01/2026 ACME CORP SALARY 5,000.00 14,879.50',
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, -120.5);
  assert.equal(rows[1].amount, 5000);
});

test('explicit CR/DR markers win over balance inference', () => {
  const { rows } = parseStatementRows([
    '05/01/2026 REFUND FROM NOON 250.00 CR',
    '06/01/2026 ATM WITHDRAWAL 500.00 DR',
  ]);

  assert.equal(rows[0].amount, 250);
  assert.equal(rows[1].amount, -500);
});

test('a single amount with no balance defaults to an expense', () => {
  const { rows } = parseStatementRows(['05/01/2026 SPINNEYS DUBAI MARINA 45.00']);
  assert.equal(rows[0].amount, -45);
});

test('skips opening/closing balance and page furniture lines', () => {
  const { rows } = parseStatementRows([
    'Page 1 of 3',
    '01/01/2026 Opening Balance 10,000.00',
    '31/01/2026 CLOSING BALANCE 9,879.50',
    '05/01/2026 UBER TRIP 45.00 9,955.00',
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'UBER TRIP');
});

test('merges a wrapped description into the preceding transaction', () => {
  const { rows } = parseStatementRows([
    '05/01/2026 TALABAT ORDER 88.00 9,912.00',
    'REF 4471 DUBAI AE',
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'TALABAT ORDER REF 4471 DUBAI AE');
});

test('does not mistake reference numbers or card digits for amounts', () => {
  const { rows } = parseStatementRows(['05/01/2026 POS 4415 CARD 1234 CARREFOUR 120.50 9,879.50']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -120.5);
});

test('reports unparseable rows as errors instead of aborting', () => {
  const { rows, errors } = parseStatementRows([
    '05/01/2026 120.50 9,879.50',
    '06/01/2026 VALID MERCHANT 45.00 9,834.50',
  ]);

  assert.equal(rows.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /missing description/);
});
