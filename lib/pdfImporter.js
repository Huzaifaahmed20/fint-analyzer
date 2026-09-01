// PDF statement import: decrypt -> extract text lines -> parse rows -> persist.
// Reuses persistRows so PDF imports get the same hash-based duplicate detection
// and categorization as CSV imports.

const { extractPages, PdfPasswordError } = require('./pdf');
const { parseStatementPages } = require('./statementColumns');
const { parseStatementRows } = require('./statement');
const { persistRows, parseDate } = require('./importer');

async function importPdf(buffer, db, categorize, password) {
  const pages = await extractPages(buffer, password);

  // Preferred: the statement has a Date/Details/Debit/Credit/Balance header, so
  // amounts can be classified by column position. Fall back to the text-shape
  // heuristics only when no such header exists.
  let parsed = parseStatementPages(pages, parseDate);
  let mode = 'columns';

  if (parsed.rows.length === 0) {
    const fallback = parseStatementRows(pages.flatMap((p) => p.lines));
    parsed = { rows: fallback.rows, errors: fallback.errors, reconciliation: null };
    mode = 'text';
  }

  if (parsed.rows.length === 0) {
    return {
      imported: 0,
      duplicates: 0,
      mode,
      errors: parsed.errors.length
        ? parsed.errors
        : [{ row: 0, message: 'No transaction rows found. If this is a scanned statement there is no text to extract.' }],
    };
  }

  return {
    ...persistRows(parsed.rows, db, categorize),
    errors: parsed.errors,
    mode,
    reconciliation: parsed.reconciliation,
  };
}

module.exports = { importPdf, PdfPasswordError };
