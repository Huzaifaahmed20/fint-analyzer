const monthInput = document.getElementById('month');
const importForm = document.getElementById('import-form');
const csvFile = document.getElementById('csv-file');
const importStatus = document.getElementById('import-status');
const totalSpendEl = document.getElementById('total-spend');
const trendChartEl = document.getElementById('trend-chart');
const categoryBreakdownEl = document.getElementById('category-breakdown');
const budgetAlertEl = document.getElementById('budget-alert');
const paceNoteEl = document.getElementById('pace-note');
const monthsListEl = document.getElementById('months-list');
const recategorizeBtn = document.getElementById('recategorize-btn');
const exportLink = document.getElementById('export-link');
const toolsStatus = document.getElementById('tools-status');
const budgetsBody = document.getElementById('budgets-body');
const transactionsBody = document.getElementById('transactions-body');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');

let knownCategories = [];

function jsonBody(payload) {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMoney(n) {
  return `AED ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function loadCategories() {
  const data = await api('/categories');
  knownCategories = data.categories;

  categoryFilter.innerHTML = '<option value="">All categories</option>';
  knownCategories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categoryFilter.appendChild(opt);
  });

  const budgetMap = new Map(data.budgets.map((b) => [b.category, b.monthly_limit]));
  const spendMap = new Map((data.settings || []).map((s) => [s.category, s.counts_as_spend]));
  budgetsBody.innerHTML = '';
  knownCategories
    .filter((c) => c !== 'Uncategorized' && c !== 'Income')
    .forEach((cat) => {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = cat;

      const limitTd = document.createElement('td');
      const limitInput = document.createElement('input');
      limitInput.type = 'number';
      limitInput.min = '0';
      limitInput.step = '1';
      limitInput.value = budgetMap.has(cat) ? budgetMap.get(cat) : '';
      limitTd.appendChild(limitInput);

      // Transfers between your own accounts should not inflate total spend.
      const spendTd = document.createElement('td');
      const spendChk = document.createElement('input');
      spendChk.type = 'checkbox';
      spendChk.checked = spendMap.has(cat) ? Boolean(spendMap.get(cat)) : true;
      spendChk.addEventListener('change', async () => {
        await api(`/category-settings/${encodeURIComponent(cat)}`, jsonBody({ counts_as_spend: spendChk.checked }));
        refreshSummary();
      });
      spendTd.appendChild(spendChk);

      const actionTd = document.createElement('td');
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', async () => {
        const value = Number(limitInput.value);
        if (!Number.isFinite(value) || value < 0) return;
        await api(`/budgets/${encodeURIComponent(cat)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthly_limit: value }),
        });
        refreshSummary();
      });
      actionTd.appendChild(saveBtn);

      tr.append(nameTd, limitTd, spendTd, actionTd);
      budgetsBody.appendChild(tr);
    });
}

function renderTrend(trend) {
  const max = Math.max(1, ...trend.map((t) => t.total));
  trendChartEl.innerHTML = '';
  trend.forEach((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'trend-bar-wrap';

    const bar = document.createElement('div');
    bar.className = 'trend-bar';
    bar.style.height = `${Math.max(2, (t.total / max) * 100)}%`;
    bar.title = fmtMoney(t.total);

    const value = document.createElement('div');
    value.className = 'trend-value';
    value.textContent = t.total >= 1000
      ? `${(t.total / 1000).toFixed(1)}k`
      : Math.round(t.total).toString();

    const label = document.createElement('div');
    label.className = 'trend-label';
    const [ty, tm] = t.month.split('-').map(Number);
    label.textContent = new Date(ty, tm - 1, 1).toLocaleString(undefined, { month: 'short' });

    wrap.append(value, bar, label);
    trendChartEl.appendChild(wrap);
  });
}

function alertBlock(className, titleText, rows, describe) {
  const box = document.createElement('div');
  box.className = className;

  const title = document.createElement('div');
  title.className = 'alert-title';
  title.textContent = titleText;

  const list = document.createElement('ul');
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.textContent = `${row.category}: ${fmtMoney(row.amount)} of ${fmtMoney(row.budget)} - `;
    const strong = document.createElement('span');
    strong.className = 'over-by';
    strong.textContent = describe(row);
    li.appendChild(strong);
    list.appendChild(li);
  });

  box.append(title, list);
  return box;
}

// Red for budgets already blown, amber for ones about to be.
function renderBudgetAlert(byCategory, pace) {
  const over = byCategory.filter((row) => row.overrun);
  const nearing = byCategory.filter((row) => row.warning || row.aheadOfPace);

  budgetAlertEl.innerHTML = '';
  budgetAlertEl.hidden = over.length === 0 && nearing.length === 0;
  if (budgetAlertEl.hidden) return;

  if (over.length > 0) {
    budgetAlertEl.appendChild(alertBlock(
      'alert',
      `Budget exceeded in ${over.length} ${over.length === 1 ? 'category' : 'categories'}`,
      over,
      (row) => `over by ${fmtMoney(row.amount - row.budget)} (${Math.round((row.amount / row.budget) * 100)}%)`
    ));
  }

  if (nearing.length > 0) {
    budgetAlertEl.appendChild(alertBlock(
      'alert warn',
      `Approaching the limit in ${nearing.length} ${nearing.length === 1 ? 'category' : 'categories'}`,
      nearing,
      (row) => {
        const used = Math.round((row.amount / row.budget) * 100);
        const elapsed = Math.round(pace.elapsed * 100);
        return row.aheadOfPace && !row.warning
          ? `${used}% used, ${elapsed}% through the month`
          : `${used}% used`;
      }
    ));
  }
}

function renderCategoryBreakdown(byCategory) {
  categoryBreakdownEl.innerHTML = '';
  if (byCategory.length === 0) {
    categoryBreakdownEl.innerHTML = '<p class="muted">No spending this month yet.</p>';
    return;
  }

  const largest = Math.max(...byCategory.map((r) => r.amount), 1);

  byCategory.forEach((row) => {
    const div = document.createElement('div');
    div.className = 'category-row';

    const pct = row.budget
      ? Math.min(100, (row.amount / row.budget) * 100)
      : (row.amount / largest) * 100;

    const state = row.overrun ? ' overrun' : (row.warning || row.aheadOfPace) ? ' warning' : '';
    const label = document.createElement('div');
    label.className = `label${state}`;
    const budgetText = row.budget ? ` / ${fmtMoney(row.budget)}` : '';
    const overText = row.overrun ? `  (over by ${fmtMoney(row.amount - row.budget)})` : '';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = row.category;
    if (row.countsAsSpend === false) {
      const note = document.createElement('span');
      note.className = 'excluded-note';
      note.textContent = '  not counted in total';
      nameSpan.appendChild(note);
    }
    const valueSpan = document.createElement('span');
    valueSpan.textContent = `${fmtMoney(row.amount)}${budgetText}${overText}`;
    label.append(nameSpan, valueSpan);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = `bar-fill${state}${row.budget ? '' : ' nobudget'}`;
    fill.style.width = `${Math.max(2, pct)}%`;
    track.appendChild(fill);

    div.append(label, track);
    categoryBreakdownEl.appendChild(div);
  });
}

async function refreshSummary() {
  const month = monthInput.value || currentMonthValue();
  const summary = await api(`/summary?month=${month}`);
  totalSpendEl.textContent = fmtMoney(summary.totalSpend);
  renderTrend(summary.trend);
  renderBudgetAlert(summary.byCategory, summary.pace);
  renderCategoryBreakdown(summary.byCategory);

  const { dayOfMonth, daysInMonth, elapsed } = summary.pace;
  const excluded = summary.excludedCategories || [];
  paceNoteEl.textContent = dayOfMonth > 0
    ? `Day ${dayOfMonth} of ${daysInMonth} - ${Math.round(elapsed * 100)}% through the month`
      + (excluded.length ? `  |  excluding ${excluded.join(', ')}` : '')
    : '';
  exportLink.href = `/api/export?month=${month}`;
}

function renderTransactions(rows) {
  transactionsBody.innerHTML = '';

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'muted empty-cell';
    td.textContent = 'No transactions for this month or filter.';
    tr.appendChild(td);
    transactionsBody.appendChild(tr);
    return;
  }

  rows.forEach((tx) => {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = tx.date;
    if (tx.reconciled === 0) {
      const flag = document.createElement('span');
      flag.className = 'row-flag';
      flag.textContent = ' !';
      flag.title = 'This row did not reconcile against the statement balance';
      dateTd.appendChild(flag);
    }

    const descTd = document.createElement('td');
    descTd.textContent = tx.description;
    descTd.title = tx.description;

    const catTd = document.createElement('td');
    const select = document.createElement('select');
    knownCategories.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      if (cat === tx.category) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async () => {
      await api(`/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: select.value }),
      });
      refreshSummary();

      // Offer to remember this choice for every transaction from the merchant.
      if (!tx.merchant) return;
      let apply = catTd.querySelector('.apply-merchant');
      if (!apply) {
        apply = document.createElement('button');
        apply.className = 'apply-merchant';
        catTd.appendChild(apply);
      }
      apply.textContent = `Apply to all "${tx.merchant}"`;
      apply.onclick = async () => {
        const result = await api(`/transactions/${tx.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: select.value, applyToMerchant: true }),
        });
        toolsStatus.textContent = `Updated ${result.applied} transaction(s) from ${tx.merchant} and saved the rule.`;
        await refreshAll();
      };
    });
    catTd.appendChild(select);

    const amountTd = document.createElement('td');
    amountTd.className = `amount ${tx.amount < 0 ? 'expense' : 'income'}`;
    amountTd.textContent = fmtMoney(tx.amount);

    tr.append(dateTd, descTd, catTd, amountTd);
    transactionsBody.appendChild(tr);
  });
}

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
}

// Every month in the data with its spend, so the whole history is visible at
// once - the rest of the dashboard only ever shows one month.
async function loadMonths() {
  const months = await api('/months');
  monthsListEl.innerHTML = '';

  if (months.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No transactions yet. Import a statement to get started.';
    monthsListEl.appendChild(p);
    return;
  }

  const selected = monthInput.value;
  const largest = Math.max(...months.map((m) => m.spend), 1);

  months.forEach((m) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `month-row${m.month === selected ? ' active' : ''}`;
    row.title = `${m.count} transactions - click to view ${monthLabel(m.month)}`;

    const head = document.createElement('span');
    head.className = 'month-head';

    const name = document.createElement('span');
    name.className = 'month-name';
    name.textContent = monthLabel(m.month);

    const value = document.createElement('span');
    value.className = 'month-value';
    value.textContent = fmtMoney(m.spend);

    head.append(name, value);

    const track = document.createElement('span');
    track.className = 'month-track';
    const fill = document.createElement('span');
    fill.className = 'month-fill';
    fill.style.width = `${Math.max(2, (m.spend / largest) * 100)}%`;
    track.appendChild(fill);

    row.append(head, track);
    row.addEventListener('click', async () => {
      monthInput.value = m.month;
      await refreshAll();
    });

    monthsListEl.appendChild(row);
  });
}

async function refreshTransactions() {
  const month = monthInput.value || currentMonthValue();
  const params = new URLSearchParams({ month });
  if (categoryFilter.value) params.set('category', categoryFilter.value);
  if (searchInput.value) params.set('search', searchInput.value);

  const rows = await api(`/transactions?${params.toString()}`);
  renderTransactions(rows);
}

async function refreshAll() {
  await refreshSummary();
  await refreshTransactions();
  await loadMonths();
}

recategorizeBtn.addEventListener('click', async () => {
  toolsStatus.textContent = 'Re-running categorization...';
  try {
    const result = await api('/recategorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    toolsStatus.textContent = `Examined ${result.examined} uncategorized row(s), updated ${result.changed}.`;
    await refreshAll();
  } catch (err) {
    toolsStatus.textContent = `Failed: ${err.message}`;
  }
});

importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = csvFile.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  importStatus.textContent = 'Importing...';
  try {
    const result = await api('/import', { method: 'POST', body: formData });
    let msg = `Imported ${result.imported}, skipped ${result.duplicates} duplicate(s).`;
    if (result.errors && result.errors.length > 0) {
      msg += ` ${result.errors.length} row(s) had errors.`;
    }
    if (result.reconciliation && result.reconciliation.mismatched > 0) {
      msg += ` Warning: ${result.reconciliation.mismatched} row(s) did not reconcile`
        + ' against the statement balance - check them against the PDF.';
    }
    importStatus.textContent = msg;
    csvFile.value = '';
    await refreshAll();
    await loadCategories();
  } catch (err) {
    importStatus.textContent = `Import failed: ${err.message}`;
  }
});

monthInput.addEventListener('change', refreshAll);
categoryFilter.addEventListener('change', refreshTransactions);
searchInput.addEventListener('input', () => {
  clearTimeout(searchInput._debounce);
  searchInput._debounce = setTimeout(refreshTransactions, 250);
});

(async function init() {
  monthInput.value = currentMonthValue();
  await loadCategories();
  await refreshAll();
})();
