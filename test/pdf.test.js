const test = require('node:test');
const assert = require('node:assert/strict');

const { groupIntoLines, extractPages } = require('../lib/pdf');

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y], width: str.length * 5 };
}

test('groupIntoLines groups by baseline and orders left-to-right, top-down', () => {
  const lines = groupIntoLines([
    item('9,879.50', 400, 700),
    item('05/01/2026', 50, 700),
    item('CARREFOUR', 150, 700),
    item('SPINNEYS', 150, 680),
    item('06/01/2026', 50, 680),
  ]);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '05/01/2026 CARREFOUR 9,879.50');
  assert.equal(lines[1].text, '06/01/2026 SPINNEYS');
});

test('groupIntoLines tolerates small baseline drift within a line', () => {
  const lines = groupIntoLines([item('A', 10, 700), item('B', 60, 701.4)]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'A B');
});

test('groupIntoLines drops whitespace-only items', () => {
  const lines = groupIntoLines([item('  ', 10, 700), item('REAL', 40, 700)]);
  assert.equal(lines[0].text, 'REAL');
});

// Minimal single-page PDF with one text run, built inline so the test needs no fixture.
function buildPdf(text) {
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`;
  return Buffer.from(
    '%PDF-1.4\n'
    + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R'
    + '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
    + `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\n`
    + '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'
    + 'trailer<</Root 1 0 R/Size 6>>\n%%EOF\n',
    'latin1'
  );
}

test('extractPages pulls text lines out of a real PDF', async () => {
  const pages = await extractPages(buildPdf('05/01/2026 CARREFOUR 120.50'), null);

  assert.equal(pages.length, 1);
  assert.equal(pages[0].lines[0].text, '05/01/2026 CARREFOUR 120.50');
});

test('extractPages surfaces a readable error for a non-PDF buffer', async () => {
  await assert.rejects(
    () => extractPages(Buffer.from('this is not a pdf'), null),
    /Could not read PDF/
  );
});
