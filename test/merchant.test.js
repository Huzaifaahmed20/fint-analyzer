const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanMerchant } = require('../lib/merchant');

test('strips card number, city/country and trailing auth reference', () => {
  assert.equal(
    cleanMerchant('CARD NO.443913XXXXXX9193 NESTO HYPERMARKET LLC DUBAI:AE 874495 16−08−2026 30.02,AED'),
    'NESTO HYPERMARKET LLC'
  );
});

test('handles the masked variant with a trailing reference number', () => {
  assert.equal(
    cleanMerchant('CARD NO.443913XXXXXX9193 SHER AFGHAN RESTAURANT DUBAI AE 104283XX XX-XX-2026 270830'),
    'SHER AFGHAN RESTAURANT'
  );
});

test('both formats of one merchant collapse to the same name', () => {
  const a = cleanMerchant('CARD NO.443913XXXXXX9193 ADNOC AL BARSHA 2 528 DUBAI:AE 164467 16−08−2026 132.66,AED');
  const b = cleanMerchant('CARD NO.443913XXXXXX9193 ADNOC AL BARSHA 2 528 DUBAI AE 033854XX XX-XX-2026 982770');
  assert.equal(a, b);
  assert.equal(a, 'ADNOC AL BARSHA');
});

test('removes a city glued to a truncated name', () => {
  assert.equal(
    cleanMerchant('CARD NO.443913XXXXXX9193 PURANMAL SWEETS AND RE SDubai AE 197280XX XX-XX-2026 396890'),
    'PURANMAL SWEETS AND RE'
  );
});

test('drops reference blobs from transfer descriptions', () => {
  assert.equal(
    cleanMerchant('MOBILE BANKING TRANSFER FROM AE5202600002158489959 01 RefNo:-B7CB2BD8F9F7'),
    'MOBILE BANKING TRANSFER FROM'
  );
});

test('keeps a usable name when there is nothing to strip', () => {
  assert.equal(cleanMerchant('CARREFOUR'), 'CARREFOUR');
});

test('never returns an empty merchant', () => {
  assert.ok(cleanMerchant('').length > 0);
  assert.ok(cleanMerchant(null).length > 0);
});
