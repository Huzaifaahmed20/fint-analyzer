const monthInput = document.getElementById('month');
const importForm = document.getElementById('import-form');
const csvFile = document.getElementById('csv-file');
const importStatus = document.getElementById('import-status');
const totalSpendEl = document.getElementById('total-spend');
const trendChartEl = document.getElementById('trend-chart');
const categoryBreakdownEl = document.getElementById('category-breakdown');
const budgetsBody = document.getElementById('budgets-body');
const transactionsBody = document.getElementById('transactions-body');
const searchInput = document.getElementById('search');
const categoryFilter = document.getElementById('category-filter');

let knownCategories = [];

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

      tr.append(nameTd, limitTd, actionTd);
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

    const label = document.createElement('div');
    label.className = 'trend-label';
    label.textContent = t.month.slice(5);

    wrap.append(bar, label);
    trendChartEl.appendChild(wrap);
  });
}

function renderCategoryBreakdown(byCategory) {
  categoryBreakdownEl.innerHTML = '';
  if (byCategory.length === 0) {
    categoryBreakdownEl.innerHTML = '<p class="muted">No spending this month yet.</p>';
    return;
  }

  byCategory.forEach((row) => {
    const div = document.createElement('div');
    div.className = 'category-row';

    const pct = row.budget ? Math.min(100, (row.amount / row.budget) * 100) : 100;

    const label = document.createElement('div');
    label.className = 'label';
    const budgetText = row.budget ? ` / ${fmtMoney(row.budget)}` : '';
    label.innerHTML = `<span>${row.category}</span><span>${fmtMoney(row.amount)}${budgetText}</span>`;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = `bar-fill${row.overrun ? ' overrun' : ''}`;
    fill.style.width = `${row.budget ? pct : 100}%`;
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
  renderCategoryBreakdown(summary.byCategory);
}

function renderTransactions(rows) {
  transactionsBody.innerHTML = '';
  rows.forEach((tx) => {
    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = tx.date;

    const descTd = document.createElement('td');
    descTd.textContent = tx.description;

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
    });
    catTd.appendChild(select);

    const amountTd = document.createElement('td');
    amountTd.className = `amount ${tx.amount < 0 ? 'expense' : 'income'}`;
    amountTd.textContent = fmtMoney(tx.amount);

    tr.append(dateTd, descTd, catTd, amountTd);
    transactionsBody.appendChild(tr);
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
}

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
