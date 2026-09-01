# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Spend Tracker: a local, single-user personal finance app. Statement import is CSV or PDF — no
bank API/OAuth integration. Everything (data, computation) stays on-device: SQLite file on disk,
no external network calls at runtime.

## Commands

```bash
npm install         # install deps (no native/compiled deps - see node:sqlite note below)
npm start            # run the server at http://localhost:4173
npm test             # run the full test suite (test/*.test.js via node:test)
```

Run a single test file:
```bash
node --disable-warning=ExperimentalWarning --test test/importer.test.js
```

Run a single test case by name:
```bash
node --disable-warning=ExperimentalWarning --test --test-name-pattern="parseDate handles" test/importer.test.js
```

There is no build step, linter, or bundler configured — this is plain CommonJS Node.js served
directly (`server.js` + `public/` static assets, no frontend framework/compiler).

The `--disable-warning=ExperimentalWarning` flag suppresses Node's warning about `node:sqlite`
being experimental; it's cosmetic only and safe to drop when debugging.

## Architecture

**Request flow**: `server.js` → `routes/api.js` (all endpoints mounted at `/api`) → `lib/*.js`
(pure logic) → `db/index.js` (the one `DatabaseSync` connection, shared/imported everywhere).
Static dashboard files (`public/index.html`, `app.js`, `styles.css`) are served directly by
Express with no templating; `public/app.js` talks to the API purely via `fetch`.

**Schema migrations**: still no migration framework. `db/index.js` holds the canonical
`CREATE TABLE`s, then brings older databases forward with `PRAGMA table_info` checks plus
`ALTER TABLE ... ADD COLUMN`, and backfills (e.g. `merchant`) in the same file. Add a column in
*both* places, and mirror it in the `makeDb()` helper inside the affected `test/*.test.js`.

**Database**: `db/index.js` uses Node's built-in `node:sqlite` (`DatabaseSync`) — deliberately
chosen over `better-sqlite3`/`sqlite3` to avoid native compilation entirely. It opens
`data/spend-tracker.db` (gitignored; created on first run) and runs `CREATE TABLE IF NOT EXISTS`
for `transactions` and `budgets` on every import — there is no separate migration system. Schema
changes go directly into that `db.exec(...)` block.

**Signed amount convention** (the one thing that ripples through every module): `transactions.amount`
is signed — **negative = money out (expense), positive = money in (income)**. This single-column
convention exists whether the source CSV used one `Amount` column or split `Debit`/`Credit`
columns; `lib/importer.js` normalizes both into it. All spend aggregation elsewhere (`lib/summary.js`,
`routes/api.js`) filters `WHERE amount < 0` and negates for display — never assume the DB stores
positive spend amounts.

**PDF import** (`lib/pdf.js` + `lib/statement.js` + `lib/pdfImporter.js`): `POST /api/import`
sniffs the upload (mimetype, `.pdf` extension, or `%PDF-` magic bytes) and routes PDFs down a
second path that converges on the same `persistRows` tail — so PDF and CSV imports share identical
dedupe and categorization. `lib/pdf.js` wraps `pdfjs-dist` (pure JS, zero deps, ESM-only so it is
pulled in via a cached dynamic `import()`); encrypted PDFs are opened with `process.env.PDF_PASSWORD`,
loaded from `.env` by `process.loadEnvFile()` in `server.js` (no `dotenv` dependency). There is
deliberately **no password field in the UI** — the password comes from `.env` only. pdf.js
`PasswordException` is translated into `PdfPasswordError` with code `NEED_PASSWORD` (protected but
no password configured) or `INCORRECT_PASSWORD`.

`lib/statement.js` is the fragile part: a PDF has no headers to match aliases against, so rows are
found structurally — a line starting with a date and ending with money tokens (two-decimal only, so
reference/card numbers are not mistaken for amounts). Direction is resolved in priority order:
explicit `CR`/`DR` marker, then an explicit minus/parentheses, then the **running-balance delta**
(if balance rose, it is income), then a default of expense. Opening/closing balance and page-furniture
lines are skipped; a line with no date and no amounts is treated as a wrapped description and appended
to the previous row. These are heuristics tuned against a synthetic statement — a new bank layout may
need adjustment here, and **scanned/image PDFs yield nothing** (no OCR, by design).

**Import pipeline** (`lib/importer.js`, called from `POST /api/import` in `routes/api.js`):
1. `detectColumns` — matches CSV headers against alias lists (`DATE_ALIASES`, `DESC_ALIASES`,
   `AMOUNT_ALIASES`, `DEBIT_ALIASES`, `CREDIT_ALIASES`) after normalizing (lowercase, strip
   non-alphanumeric). This is how varying bank export headers (`Value Date`, `Narration`,
   `Withdrawal`, etc.) get recognized without per-bank config. Add new bank formats by extending
   these alias arrays, not by branching on a bank name.
2. `normalizeRows` — parses each row's date (`parseDate`) and amount (`parseAmount`) into the
   canonical `{date, description, amount}` shape; bad rows are collected as `{row, message}`
   errors rather than aborting the whole import.
3. `parseDate` assumes **day-first** (`DD/MM/YYYY`) for ambiguous numeric dates — matches UAE bank
   exports (Emirates NBD etc.), the app's original target. This is not locale-configurable; if you
   need US-style `MM/DD/YYYY` support, that's a real ambiguity to resolve deliberately, not just a
   regex tweak.
4. `hashTransaction` (SHA-256 of `date|description|amount`) is the dedupe key, enforced by a
   `UNIQUE` constraint on `transactions.hash`. Re-importing an overlapping statement silently
   skips rows whose hash already exists — this is the entire duplicate-detection mechanism, there's
   no fuzzy matching.
5. Only rows that pass normalization and aren't duplicates get categorized (`lib/categorizer.js`)
   and inserted. Steps 4-5 live in `persistRows`, shared with the PDF path.

**Merchant extraction** (`lib/merchant.js`): `cleanMerchant` reduces raw bank text
(`CARD NO.443913XXXXXX9193 NESTO HYPERMARKET LLC DUBAI:AE 874495 16-08-2026 30.02,AED`) to
`NESTO HYPERMARKET LLC`. Stored in `transactions.merchant` at import and used for display,
per-merchant rules and recurring detection. It strips two trailing formats (plain and masked
`XX-XX-2026`), `CITY:CC` and bare `CITY CC` suffixes, leading/trailing reference blobs, and
trailing city names. Statement text is messy; extend the token rules rather than special-casing
a merchant.

**Two-layer categorization**: `merchant_rules` (learned from `PATCH /api/transactions/:id` with
`applyToMerchant: true`) is checked **before** the keyword rules, so a manual correction is never
undone by a later import. The composition lives in `makeCategorizer()` in `routes/api.js`;
`lib/categorizer.js` itself stays keyword-only. `POST /api/recategorize` re-runs the whole thing
over existing rows - by default only `Uncategorized` ones, since categories are a stored column
written once at import, never recomputed on read.

**Non-spend categories**: `category_settings.counts_as_spend = 0` keeps a category (typically
`Transfers`) out of `totalSpend` and the trend while still listing it in the breakdown. Handled in
`lib/summary.js` via `nonSpendCategories`.

**Budget states** (`lib/summary.js`): `overrun` (past the limit, red), `warning` (>= `WARN_AT`,
80%, amber), and `aheadOfPace` (using more of the budget than the fraction of the month elapsed -
see `monthPace`, which treats a past month as fully elapsed). `buildSummary` takes an injectable
`now` so pace is testable.

**Recurring detection** (`lib/recurring.js`): groups spend by `merchant` x month; a merchant seen in
>= 2 distinct months is recurring, and `steady` (spread/average < 15%) marks subscription-like
charges. Needs 2+ months of data to report anything.

**Categorization** (`lib/categorizer.js` + `config/categories.json`): first-match keyword
search (case-insensitive) over the description, anchored at a **word boundary at the start** of the
keyword (so `mart` matches "BLUE MART" but not "SMART", and `fee` does not match "COFFEE"); the end
is unanchored so plurals still match. Matched in the JSON file's key order — not
scored/ranked, so keyword list order in `categories.json` matters when a description could match
more than one category. No match falls back to `Income` (positive amount) or `Uncategorized`
(negative amount). `routes/api.js` derives its list of known categories (`KNOWN_CATEGORIES`, used
for the dropdown/filter API) from `Object.keys(categoryRules)` plus `Uncategorized` — adding a
category means editing `categories.json`; nothing else needs updating.

**Summary/aggregation** (`lib/summary.js`): all month-based queries use half-open date ranges
(`date >= start AND date < end`, computed by `monthRange`) rather than string-prefix matching, so
they stay correct across year boundaries — see `shiftMonth` for the year-rollover logic used to
build the 6-month trend. `buildSummary` is the single source of truth the dashboard's summary
cards depend on (total spend, per-category vs. budget overrun, trend); it re-queries per category
rather than reusing a single grouped result, since budgets need to be joined in per category.

**Frontend** (`public/app.js`): a single vanilla-JS file, no framework, no build step, no CDN
dependencies (deliberate — matches the "no external calls" design goal in the README). All charts
(budget bars, 6-month trend) are hand-rolled with CSS width/height percentages, not a charting
library.

## Key design decisions (from the project's original plan)

- CSV-first over a bank API integration, to avoid compliance/licensing overhead for personal use.
- SQLite + local file storage only — no cloud, no external calls, everything stays on-device.
- Currency is shown as "AED" in the UI as a cosmetic label only; there is no currency conversion
  logic anywhere in the codebase.
