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
