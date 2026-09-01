// PDF text extraction via pdfjs-dist (pure JS, no native deps, no network).
// pdfjs-dist v6 ships ESM only, so it is pulled in with a cached dynamic import
// from this CommonJS module.

const PDFJS_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

// Items whose baselines differ by less than this many PDF units are treated as
// belonging to the same visual line.
const Y_TOLERANCE = 2;

let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import(PDFJS_SPECIFIER);
  return pdfjsPromise;
}

class PdfPasswordError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PdfPasswordError';
    this.code = code; // 'NEED_PASSWORD' | 'INCORRECT_PASSWORD'
  }
}

// Group positioned text items into visual lines, top-of-page first, each line's
// items ordered left to right. PDF y-coordinates increase upward, hence the
// descending sort.
function groupIntoLines(items) {
  const lines = [];

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width || 0;

    let line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ str: item.str, x, y, width });
  }

  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((i) => i.str.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  return lines.filter((l) => l.text);
}

// Returns [{ page, lines: [{ y, text, items }] }]. `password` may be null for
// unprotected files.
async function extractPages(buffer, password) {
  const pdfjs = await loadPdfjs();

  let doc;
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      password: password || undefined,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    });
    doc = await loadingTask.promise;
  } catch (err) {
    if (err instanceof pdfjs.PasswordException) {
      if (err.code === pdfjs.PasswordResponses.NEED_PASSWORD) {
        throw new PdfPasswordError('NEED_PASSWORD', 'This PDF is password protected. Set PDF_PASSWORD in .env');
      }
      throw new PdfPasswordError('INCORRECT_PASSWORD', 'PDF_PASSWORD in .env did not unlock this PDF');
    }
    throw new Error(`Could not read PDF: ${err.message}`);
  }

  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push({ page: n, lines: groupIntoLines(content.items) });
    page.cleanup();
  }
  await loadingTask.destroy();

  return pages;
}

module.exports = { extractPages, groupIntoLines, PdfPasswordError };
