# Spend Tracker

A local, CSV-based personal spend tracker. No bank connection — CSV import only.
Node.js + Express + SQLite (via Node's built-in `node:sqlite`), single-user, runs entirely on your machine.

## Features

- CSV import with auto-detected columns (`Date`/`Description`/`Amount`, or `Date`/`Description`/`Debit`/`Credit`),
  including common bank export aliases (`Value Date`, `Narration`, `Withdrawal`, `Deposit`, ...)
- Duplicate detection on re-import (hash of date + description + amount)
- Keyword-based auto-categorization (`config/categories.json`)
- Manual recategorization per transaction
- Monthly budgets per category, with overrun highlighting
- Dashboard: total spend, category breakdown, budget bars, 6-month trend, transaction table with search/filter

## Setup

Requires Node.js 22.5+ (uses the built-in `node:sqlite` module — no native dependencies to compile).

```bash
npm install
npm start
```

Then open http://localhost:4173.

## Importing transactions

Export a CSV from your bank and upload it from the dashboard's "Import CSV" card. The importer auto-detects
columns by header name; if your bank's export uses unusual headers, add the alias to `lib/importer.js`
(`DATE_ALIASES` / `DESC_ALIASES` / `AMOUNT_ALIASES` / `DEBIT_ALIASES` / `CREDIT_ALIASES`).

Dates are parsed as ISO (`YYYY-MM-DD`) or day-first (`DD/MM/YYYY`, `DD-MM-YYYY`, `5 Jan 2026`) — day-first
matches typical UAE bank exports. Amounts may include currency labels, thousands separators, or
parentheses for negatives (e.g. `AED 1,250.00`, `(75.00)`).

Re-importing the same statement (or an overlapping date range) skips rows that were already imported.

## Categorization

`config/categories.json` maps category names to keyword lists; the first category whose keyword appears
in a transaction's description (case-insensitive substring match) wins. Transactions with no keyword
match fall back to `Income` (positive amounts) or `Uncategorized` (negative amounts). Edit the JSON file
to tune categorization for your own merchants, then re-import or manually recategorize existing rows from
the dashboard.

## Budgets

Set a monthly AED limit per category from the "Budgets" card. The category breakdown and its progress
bars turn red when a category's spend for the selected month exceeds its budget.

## Data storage

Everything is stored locally in `data/spend-tracker.db` (SQLite, gitignored). No cloud, no external calls.
Currency is shown as AED in the UI as a cosmetic label only — there is no currency conversion.

## Tests

```bash
npm test
```

Covers CSV column detection, date/amount parsing, duplicate detection, categorization, and monthly
summary aggregation.
