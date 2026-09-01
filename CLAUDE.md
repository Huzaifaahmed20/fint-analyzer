# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Spend Tracker: a local, single-user personal finance app. CSV bank statement import only — no
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
   and inserted.

**Categorization** (`lib/categorizer.js` + `config/categories.json`): first-match keyword
substring search (case-insensitive) over the description, in the JSON file's key order — not
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
