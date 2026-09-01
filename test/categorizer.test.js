const test = require('node:test');
const assert = require('node:assert/strict');

const { categorize } = require('../lib/categorizer');

const rules = {
  Groceries: ['carrefour', 'spinneys'],
  Income: ['salary'],
};

test('matches keyword case-insensitively', () => {
  assert.equal(categorize('CARREFOUR HYPERMARKET DUBAI', -120, rules), 'Groceries');
});

test('falls back to Income for positive amounts with no keyword match', () => {
  assert.equal(categorize('ACME CORP PAYROLL', 5000, rules), 'Income');
});

test('falls back to Uncategorized for negative amounts with no keyword match', () => {
  assert.equal(categorize('RANDOM SHOP', -50, rules), 'Uncategorized');
});

test('keywords match at a word boundary, not mid-word', () => {
  const boundaryRules = { Groceries: ['mart'], Fees: ['fee'] };

  assert.equal(categorize('BLUE MART FRESH MINI MA', -15, boundaryRules), 'Groceries');
  assert.equal(categorize('SMART DUBAI GOVERNMENT', -50, boundaryRules), 'Uncategorized');
  assert.equal(categorize('SERVICE FEE', -5, boundaryRules), 'Fees');
  assert.equal(categorize('STARBUCKS COFFEE', -22, boundaryRules), 'Uncategorized');
});

test('real rules put marts and hypermarkets in Groceries', () => {
  const rules = require('../config/categories.json');

  assert.equal(categorize('NESTO HYPERMARKET LLC DUBAI:AE', -30, rules), 'Groceries');
  assert.equal(categorize('BLUE MART FRESH MINI MA DUBAI:AE', -15, rules), 'Groceries');
  assert.equal(categorize('WEST ZONE SUPERMARKET', -60, rules), 'Groceries');
});

test('real rules recognise car finance, including Islamic naming', () => {
  const rules = require('../config/categories.json');

  assert.equal(categorize('CAR LOAN INSTALMENT AUG', -1850, rules), 'Car Loan');
  assert.equal(categorize('DIB AUTO MURABAHA INSTALMENT', -1850, rules), 'Car Loan');
  assert.equal(categorize('VEHICLE FINANCE PAYMENT', -1850, rules), 'Car Loan');
});

test('a "re:" keyword is treated as a regular expression', () => {
  const rules = { Flagged: ['re:\\d{2}:\\d{2}:\\d{2}\\s+E\\d{6,}'] };

  assert.equal(categorize('-04-2026 15:59:25 E4012034 932874 ENBD', -8300, rules), 'Flagged');
  assert.equal(categorize('NESTO HYPERMARKET 874495 16-08-2026', -30, rules), 'Uncategorized');
});

test('real rules put ATM withdrawals in Cash Withdrawal', () => {
  const rules = require('../config/categories.json');

  // No merchant name - recognised by the timestamp + terminal id shape.
  assert.equal(
    categorize('CARD NO.443913XXXXXX9193 -04−2026 15:59:25 E4012034 932874 ENBD Meydan M Building DUBAI AE', -8300, rules),
    'Cash Withdrawal'
  );
  assert.equal(categorize('ATM CASH WITHDRAWAL DUBAI', -500, rules), 'Cash Withdrawal');
});

test('"atm" does not match a word merely starting with those letters', () => {
  const rules = require('../config/categories.json');
  assert.notEqual(categorize('ATMOSPHERE LOUNGE BURJ KHALIFA', -320, rules), 'Cash Withdrawal');
});

test('ordinary transfers are not swept into Cash Withdrawal', () => {
  const rules = require('../config/categories.json');
  assert.equal(categorize('MOBILE BANKING TRANSFER TO AE5202600002158489959', -100, rules), 'Transfers');
});
