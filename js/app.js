(function () {
  'use strict';

  const STORAGE_KEY = 'misGastos.v2';
  const LEGACY_KEY = 'misGastos.v1';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const CURRENCIES = [
    ['PHP', 'Peso filipino (₱)'], ['COP', 'Peso colombiano ($)'], ['USD', 'Dólar (US$)'], ['EUR', 'Euro (€)'],
    ['MXN', 'Peso mexicano'], ['CLP', 'Peso chileno'], ['ARS', 'Peso argentino'], ['PEN', 'Sol peruano'], ['GBP', 'Libra (£)'],
  ];

  // ---------- Estado ----------
  // Dos controladores independientes (Filipinas y Colombia) + el registro de envíos entre ellos.
  const emptyLedger = (name, flag, currency) => ({ name, flag, currency, transactions: [], budgets: {}, categories: [] });
  const defaultState = () => ({
    version: 2,
    active: 'ph',
    ledgers: { ph: emptyLedger('Filipinas', '🇵🇭', 'PHP'), co: emptyLedger('Colombia', '🇨🇴', 'COP') },
    fx: { transfers: [], referenceRate: null },
  });

  function normalizeState(data) {
    const st = defaultState();
    if (data && data.ledgers) {
      for (const k of ['ph', 'co']) Object.assign(st.ledgers[k], data.ledgers[k] || {});
      st.active = data.active === 'co' ? 'co' : 'ph';
      Object.assign(st.fx, data.fx || {});
    } else if (data && Array.isArray(data.transactions)) {
      // Versión anterior (un solo controlador): pasa a Filipinas.
      Object.assign(st.ledgers.ph, {
        transactions: data.transactions, budgets: data.budgets || {}, categories: data.categories || [],
        currency: (data.settings && data.settings.currency) || 'PHP',
      });
    }
    return st;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      return normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.');
    }
  }

  let state = load();
  const L = () => state.ledgers[state.active];
  let currentMonth = latestMonth() || monthKey(new Date());
  let currentView = 'resumen';
  const charts = {};

  // ---------- Utilidades ----------
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }

  // Último mes con gastos (los ingresos futuros ya planeados no cuentan).
  function latestMonth(txs) {
    txs = txs || L().transactions;
    let max = '', maxAny = '';
    for (const t of txs) {
      const k = t.date.slice(0, 7);
      if (k > maxAny) maxAny = k;
      if (t.type === 'expense' && k > max) max = k;
    }
    return max || maxAny;
  }

  function monthLabel(key, short) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es', short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
  }

  // Montos grandes sin decimales: se leen mejor y caben en el celular.
  function fmt(n, currency) {
    const decimals = Math.abs(n) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat('es', {
        // "US$" para no confundir dólares con pesos colombianos ($).
        style: 'currency', currency: currency || L().currency, currencyDisplay: (currency || L().currency) === 'USD' ? 'symbol' : 'narrowSymbol',
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(n);
    } catch (e) {
      return n.toFixed(decimals);
    }
  }
  const fmtPh = n => fmt(n, state.ledgers.ph.currency);
  const fmtCo = n => fmt(n, state.ledgers.co.currency);
  const fmtRate = n => n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function allCategories() {
    const set = new Set(L().categories);
    for (const t of L().transactions) set.add(t.category);
    for (const c of Object.keys(L().budgets)) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  function txOfMonth(key, ledger) { return (ledger || L()).transactions.filter(t => t.date.startsWith(key)); }

  // Gastos pagados (los pendientes no cuentan como gastado).
  function sumBy(txs, type) { return txs.reduce((s, t) => s + (t.type === type && !t.pending ? t.amount : 0), 0); }
  const sumPending = txs => txs.reduce((s, t) => s + (t.type === 'expense' && t.pending ? t.amount : 0), 0);

  function transfersOfMonth(key) { return state.fx.transfers.filter(t => t.date.startsWith(key)); }

  // Para Colombia, lo recibido por traslados cuenta como ingreso del mes.
  function incomeOfMonth(key) {
    const own = sumBy(txOfMonth(key), 'income');
    return state.active === 'co' ? own + transfersOfMonth(key).reduce((s, t) => s + t.cop, 0) : own;
  }

  // ---------- Navegación ----------
  function showView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $('.month-picker').style.visibility = ['resumen', 'movimientos', 'cambio'].includes(name) ? 'visible' : 'hidden';
    $('#ledgerSwitch').classList.toggle('hidden', !['resumen', 'movimientos', 'presupuestos'].includes(name));
    if (name === 'presupuestos') renderBudgetForm();
    if (name === 'cambio') renderFx();
    window.scrollTo(0, 0);
  }

  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));

  function setLedger(key) {
    state.active = key;
    save();
    $$('#ledgerSwitch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ledger === key)));
    $('#importLedger').value = key;
    $('#txSearch').value = '';
    render();
    if (currentView === 'presupuestos') renderBudgetForm();
  }
  $$('#ledgerSwitch button').forEach(b => b.addEventListener('click', () => setLedger(b.dataset.ledger)));

  function setMonth(key) {
    currentMonth = key;
    $('#monthInput').value = key;
    const [y, m] = key.split('-').map(Number);
    $('#monthLabel').textContent = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'long' }) + ' ' + y;
    render();
  }
  $('#prevMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, -1)));
  $('#nextMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, 1)));
  $('#monthInput').addEventListener('change', e => { if (e.target.value) setMonth(e.target.value); });

  // ---------- Resumen ----------
  function render() {
    renderDashboard();
    renderTxList();
    renderCategoryOptions();
    if (currentView === 'cambio') renderFx();
    fitKpis();
  }

  // Montos largos (millones de COP) en letra más pequeña para que quepan en el celular.
  function fitKpis() {
    $$('.kpi-value').forEach(el => el.classList.toggle('long', el.textContent.length > 11));
  }

  function renderDashboard() {
    const empty = !L().transactions.length;
    $('#emptyState').classList.toggle('hidden', !empty);
    $$('.needs-data').forEach(el => el.classList.toggle('hidden', empty));

    const txs = txOfMonth(currentMonth);
    const spent = sumBy(txs, 'expense');
    const pending = sumPending(txs);
    const income = incomeOfMonth(currentMonth);
    const prevSpent = sumBy(txOfMonth(shiftMonth(currentMonth, -1)), 'expense');

    $('#kpiSpent').textContent = fmt(spent);
    if (prevSpent > 0) {
      const pct = ((spent - prevSpent) / prevSpent) * 100;
      const el = $('#kpiSpentDelta');
      el.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '% vs. mes anterior';
      el.className = 'kpi-sub ' + (pct > 0 ? 'bad' : 'good');
    } else {
      $('#kpiSpentDelta').textContent = '';
    }
    $('#kpiPending').textContent = pending ? 'Pendiente por pagar: ' + fmt(pending) : '';

    const totalBudget = Object.values(L().budgets).reduce((s, v) => s + (v || 0), 0);
    if (totalBudget > 0) {
      const left = totalBudget - spent;
      $('#kpiLeft').textContent = fmt(left);
      $('#kpiLeft').classList.toggle('bad', left < 0);
      $('#kpiLeftSub').textContent = 'de ' + fmt(totalBudget) + ' (' + Math.round((spent / totalBudget) * 100) + '% usado)';
    } else {
      $('#kpiLeft').textContent = '–';
      $('#kpiLeft').classList.remove('bad');
      $('#kpiLeftSub').textContent = 'Define presupuestos';
    }

    $('#kpiIncomeLabel').textContent = state.active === 'co' ? 'Recibido (traslados)' : 'Ingresos';
    $('#kpiIncome').textContent = income ? fmt(income) : '–';
    $('#kpiBalance').textContent = income ? 'Balance: ' + fmt(income - spent) : '';

    const last6 = [];
    for (let i = 1; i <= 6; i++) {
      const s = sumBy(txOfMonth(shiftMonth(currentMonth, -i)), 'expense');
      if (s > 0) last6.push(s);
    }
    $('#kpiAvg').textContent = last6.length ? fmt(last6.reduce((a, b) => a + b, 0) / last6.length) : '–';

    const today = new Date();
    if (currentMonth === monthKey(today) && spent > 0) {
      const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      $('#kpiProjection').textContent = 'Proyección fin de mes: ' + fmt((spent / today.getDate()) * days);
    } else {
      $('#kpiProjection').textContent = last6.length ? 'meses con datos: ' + last6.length : '';
    }

    renderCharts(txs);
    renderBudgetTable(txs);
  }

  function palette(n) {
    const base = ['#0f766e', '#2563eb', '#d97706', '#db2777', '#7c3aed', '#16a34a', '#dc2626', '#0891b2', '#ca8a04', '#4f46e5', '#65a30d', '#9333ea'];
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
  }

  function chartDefaults() {
    Chart.defaults.color = cssVar('--text-muted');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  }

  const shortTick = f => v => f(v).replace(/[.,]00(?=\D*$)/, '');

  function renderCharts(txs) {
    if (typeof Chart === 'undefined') return;
    chartDefaults();
    const grid = cssVar('--border');

    const byCat = {};
    for (const t of txs) if (t.type === 'expense' && !t.pending) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

    charts.cat && charts.cat.destroy();
    charts.cat = new Chart($('#chartCategories'), {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c[0]),
        datasets: [{ data: cats.map(c => c[1]), backgroundColor: palette(cats.length), borderColor: cssVar('--surface'), borderWidth: 2 }],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.parsed) } },
        },
      },
    });

    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
    const spentSeries = months.map(k => sumBy(txOfMonth(k), 'expense'));
    const incomeSeries = months.map(incomeOfMonth);
    const hasIncome = incomeSeries.some(v => v > 0);
    const accent = cssVar('--accent');

    const datasets = [{
      label: 'Gastos', data: spentSeries, borderRadius: 4,
      backgroundColor: months.map(k => (k === currentMonth ? accent : accent + '66')),
    }];
    if (hasIncome) datasets.push({ type: 'line', label: state.active === 'co' ? 'Recibido' : 'Ingresos', data: incomeSeries, borderColor: cssVar('--good'), backgroundColor: cssVar('--good'), tension: 0.3, pointRadius: 2 });

    charts.trend && charts.trend.destroy();
    charts.trend = new Chart($('#chartTrend'), {
      type: 'bar',
      data: { labels: months.map(k => monthLabel(k, true)), datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: hasIncome, position: 'bottom' },
          tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmt(c.parsed.y) } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: grid }, ticks: { callback: shortTick(v => fmt(v)) } },
        },
        onClick: (_, els) => { if (els.length) setMonth(months[els[0].index]); },
      },
    });
  }

  function renderBudgetTable(txs) {
    const budgets = L().budgets;
    const byCat = {};
    for (const t of txs) if (t.type === 'expense' && !t.pending) byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    const pend = {};
    for (const t of txs) if (t.type === 'expense' && t.pending) pend[t.category] = (pend[t.category] || 0) + t.amount;
    const cats = Array.from(new Set(Object.keys(byCat).concat(Object.keys(pend), Object.keys(budgets).filter(c => budgets[c] > 0))));
    cats.sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    if (!cats.length) {
      $('#budgetTable').innerHTML = '<p class="hint">Sin gastos en ' + escapeHtml(monthLabel(currentMonth)) + '.</p>';
      return;
    }
    $('#budgetTable').innerHTML = cats.map(c => {
      const spent = byCat[c] || 0;
      const budget = budgets[c] || 0;
      const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
      const status = !budget ? '' : spent > budget * 1.005 ? 'over' : spent > budget * 0.85 ? 'warn' : 'ok';
      return '<div class="budget-row ' + status + '">' +
        '<div class="budget-head"><span class="budget-name">' + escapeHtml(c) + (pend[c] ? '<span class="tx-badge">pendiente ' + fmt(pend[c]) + '</span>' : '') + '</span>' +
        '<span class="budget-amt">' + fmt(spent) + (budget ? ' <small>/ ' + fmt(budget) + '</small>' : '') + '</span></div>' +
        (budget ? '<div class="bar"><div class="bar-fill" style="width:' + pct + '%"></div></div>' : '') +
        '</div>';
    }).join('');
  }

  // ---------- Movimientos ----------
  function renderCategoryOptions() {
    const cats = allCategories();
    const sel = $('#txCategoryFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => '<option>' + escapeHtml(c) + '</option>').join('');
    sel.value = cats.includes(cur) ? cur : '';
    $('#categoryOptions').innerHTML = cats.map(c => '<option value="' + escapeHtml(c) + '">').join('');
  }

  function renderTxList() {
    const q = Parse.normalize($('#txSearch').value);
    const cat = $('#txCategoryFilter').value;
    const txs = txOfMonth(currentMonth)
      .filter(t => (!cat || t.category === cat) && (!q || Parse.normalize(t.description + ' ' + t.category).includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);

    if (!txs.length) {
      $('#txList').innerHTML = '<p class="hint">No hay movimientos para este filtro.</p>';
      return;
    }
    $('#txList').innerHTML = txs.map(t => {
      const d = new Date(t.date + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' });
      return '<button class="tx" data-id="' + t.id + '">' +
        '<span class="tx-date">' + d + '</span>' +
        '<span class="tx-main"><span class="tx-desc">' + escapeHtml(t.description || t.category) + (t.pending ? '<span class="tx-badge">pendiente</span>' : '') + '</span>' +
        '<span class="tx-cat">' + escapeHtml(t.category) + '</span></span>' +
        '<span class="tx-amt ' + t.type + (t.pending ? ' pending' : '') + '">' + (t.type === 'income' ? '+' : '−') + fmt(t.amount) + '</span></button>';
    }).join('');
  }

  $('#txSearch').addEventListener('input', renderTxList);
  $('#txCategoryFilter').addEventListener('change', renderTxList);
  $('#txList').addEventListener('click', e => {
    const b = e.target.closest('.tx');
    if (b) openTxDialog(L().transactions.find(t => t.id === b.dataset.id));
  });
  $('#addTxBtn').addEventListener('click', () => openTxDialog(null));

  function defaultDate() {
    const today = new Date();
    return currentMonth === monthKey(today) ? Parse.toISODate(today) : currentMonth + '-01';
  }

  let editingId = null;
  function openTxDialog(tx) {
    const f = $('#txForm');
    editingId = tx ? tx.id : null;
    $('#txDialogTitle').textContent = (tx ? 'Editar movimiento' : 'Nuevo movimiento') + ' · ' + L().flag + ' ' + L().name;
    f.type.value = tx ? tx.type : 'expense';
    f.date.value = tx ? tx.date : defaultDate();
    f.amount.value = tx ? tx.amount : '';
    f.category.value = tx ? tx.category : '';
    f.description.value = tx ? tx.description : '';
    f.pending.checked = !!(tx && tx.pending);
    $('#txDelete').classList.toggle('hidden', !tx);
    $('#txDialog').returnValue = '';
    $('#txDialog').showModal();
  }

  $('#txDialog').addEventListener('close', () => {
    if ($('#txDialog').returnValue !== 'save') return;
    const f = $('#txForm');
    const tx = {
      date: f.date.value,
      amount: Math.round(parseFloat(f.amount.value) * 100) / 100,
      type: f.type.value,
      category: f.category.value.trim() || 'Sin categoría',
      description: f.description.value.trim(),
    };
    if (f.pending.checked && tx.type === 'expense') tx.pending = true;
    if (!tx.date || !(tx.amount > 0)) return;
    const list = L().transactions;
    if (editingId) {
      const i = list.findIndex(t => t.id === editingId);
      // Conserva el origen (hoja importada) para que re-importar siga funcionando.
      if (i >= 0) list[i] = Object.assign({ id: editingId, source: list[i].source }, tx);
    } else {
      tx.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      list.push(tx);
    }
    save();
    render();
    toast('Movimiento guardado');
  });

  $('#txDelete').addEventListener('click', () => {
    if (!editingId || !confirm('¿Eliminar este movimiento?')) return;
    L().transactions = L().transactions.filter(t => t.id !== editingId);
    save();
    $('#txDialog').close('deleted');
    render();
    toast('Movimiento eliminado');
  });

  // ---------- Cambio ----------
  function fxRows() {
    return state.fx.transfers.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => {
      const key = t.date.slice(0, 7);
      const spent = sumBy(txOfMonth(key, state.ledgers.co), 'expense');
      return Object.assign({}, t, { key, rate: t.cop / t.php, spent, balance: t.cop - spent });
    });
  }

  function monthFx(key) {
    const ts = transfersOfMonth(key);
    if (!ts.length) return null;
    const php = ts.reduce((s, t) => s + t.php, 0);
    const cop = ts.reduce((s, t) => s + t.cop, 0);
    const usd = ts.reduce((s, t) => s + (t.usd || 0), 0);
    return { php, cop, usd, rate: cop / php, n: ts.length };
  }

  function renderFx() {
    const has = state.fx.transfers.length > 0;
    $('#fxEmpty').classList.toggle('hidden', has);
    $$('.fx-data').forEach(el => el.classList.toggle('hidden', !has));
    if (!has) return;

    const co = state.ledgers.co;
    const m = monthFx(currentMonth);
    const prev = monthFx(shiftMonth(currentMonth, -1));
    const spent = sumBy(txOfMonth(currentMonth, co), 'expense');
    const pending = sumPending(txOfMonth(currentMonth, co));
    const ref = state.fx.referenceRate;

    $('#fxSent').textContent = m ? fmtPh(m.php) : '–';
    $('#fxSentSub').textContent = m ? (m.usd ? 'vía ' + fmt(m.usd, 'USD') + ' · ' + fmtRate(m.php / m.usd) + ' ₱/US$' : m.n + ' envío(s)') : 'Sin envíos este mes';
    $('#fxReceived').textContent = m ? fmtCo(m.cop) : '–';
    $('#fxReceivedSub').textContent = m && m.usd ? fmtRate(m.cop / m.usd) + ' COP/US$' : '';

    $('#fxRate').textContent = m ? fmtRate(m.rate) : '–';
    const rs = $('#fxRateSub');
    if (m && prev) {
      const pct = (m.rate / prev.rate - 1) * 100;
      rs.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '% vs. mes anterior';
      rs.className = 'kpi-sub ' + (pct >= 0 ? 'good' : 'bad');
    } else {
      rs.textContent = '';
    }
    const rr = $('#fxRateRef');
    if (m && ref) {
      const pct = (m.rate / ref - 1) * 100;
      rr.textContent = (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '% vs. referencia ' + fmtRate(ref);
      rr.className = 'kpi-sub ' + (pct >= 0 ? 'good' : 'bad');
    } else {
      rr.textContent = '';
    }

    const received = m ? m.cop : 0;
    const balance = received - spent;
    $('#fxBalance').textContent = received || spent ? fmtCo(balance) : '–';
    $('#fxBalance').classList.toggle('bad', balance < 0);
    $('#fxBalanceSub').textContent = 'Gastado ' + fmtCo(spent) + (pending ? ' · pendiente ' + fmtCo(pending) : '') +
      (m && pending ? ' · quedaría ' + fmtCo(balance - pending) : '');

    renderFxChart();
    renderFxTable();
    fitKpis();
  }

  function renderFxChart() {
    if (typeof Chart === 'undefined') return;
    chartDefaults();
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
    const rates = months.map(k => { const m = monthFx(k); return m ? Math.round(m.rate * 100) / 100 : null; });
    const accent = cssVar('--accent');
    const datasets = [{
      label: 'COP por ₱', data: rates, borderColor: accent, backgroundColor: accent, tension: 0.25, spanGaps: true,
      pointRadius: months.map(k => (k === currentMonth ? 5 : 3)),
    }];
    const ref = state.fx.referenceRate;
    if (ref) datasets.push({ label: 'Referencia', data: months.map(() => ref), borderColor: cssVar('--text-muted'), borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 });

    charts.fx && charts.fx.destroy();
    charts.fx = new Chart($('#chartFx'), {
      type: 'line',
      data: { labels: months.map(k => monthLabel(k, true)), datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !!ref, position: 'bottom' },
          tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmtRate(c.parsed.y) } },
        },
        scales: { x: { grid: { display: false } }, y: { grid: { color: cssVar('--border') } } },
        onClick: (_, els) => { if (els.length) setMonth(months[els[0].index]); },
      },
    });
  }

  function renderFxTable() {
    const rows = fxRows();
    const tot = rows.reduce((a, r) => ({ php: a.php + r.php, cop: a.cop + r.cop, spent: a.spent + r.spent }), { php: 0, cop: 0, spent: 0 });
    $('#fxTable').innerHTML =
      '<thead><tr><th>Fecha</th><th class="num">Enviado ₱</th><th class="num">US$</th><th class="num">Recibido COP</th>' +
      '<th class="num">COP/₱</th><th class="num">₱/US$</th><th class="num">Gastado COP</th><th class="num">Saldo COP</th></tr></thead><tbody>' +
      rows.map(r => '<tr data-id="' + r.id + '"' + (r.key === currentMonth ? ' class="selected"' : '') + '>' +
        '<td>' + new Date(r.date + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' }) + '</td>' +
        '<td class="num">' + fmtPh(r.php) + '</td>' +
        '<td class="num">' + (r.usd ? fmt(r.usd, 'USD') : '–') + '</td>' +
        '<td class="num">' + fmtCo(r.cop) + '</td>' +
        '<td class="num">' + fmtRate(r.rate) + '</td>' +
        '<td class="num">' + (r.usd ? fmtRate(r.php / r.usd) : '–') + '</td>' +
        '<td class="num">' + fmtCo(r.spent) + '</td>' +
        '<td class="num ' + (r.balance < 0 ? 'bad' : 'good') + '">' + fmtCo(r.balance) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + fmtPh(tot.php) + '</td><td></td><td class="num">' + fmtCo(tot.cop) + '</td>' +
      '<td class="num">' + (tot.php ? fmtRate(tot.cop / tot.php) : '') + '</td><td></td><td class="num">' + fmtCo(tot.spent) + '</td>' +
      '<td class="num ' + (tot.cop - tot.spent < 0 ? 'bad' : 'good') + '">' + fmtCo(tot.cop - tot.spent) + '</td></tr></tfoot>';
  }

  $('#fxTable').addEventListener('click', e => {
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr) openFxDialog(state.fx.transfers.find(t => t.id === tr.dataset.id));
  });
  $('#fxAdd').addEventListener('click', () => openFxDialog(null));
  $('#fxAddEmpty').addEventListener('click', () => openFxDialog(null));

  let editingFx = null;
  function openFxDialog(t) {
    const f = $('#fxForm');
    editingFx = t ? t.id : null;
    $('#fxDialogTitle').textContent = t ? 'Editar transferencia' : 'Nueva transferencia';
    f.date.value = t ? t.date : defaultDate();
    f.php.value = t ? t.php : '';
    f.usd.value = t && t.usd ? t.usd : '';
    f.cop.value = t ? t.cop : '';
    $('#fxDelete').classList.toggle('hidden', !t);
    updateFxFormRate();
    $('#fxDialog').returnValue = '';
    $('#fxDialog').showModal();
  }

  function updateFxFormRate() {
    const f = $('#fxForm');
    const php = parseFloat(f.php.value), cop = parseFloat(f.cop.value), usd = parseFloat(f.usd.value);
    const parts = [];
    if (php > 0 && cop > 0) parts.push('Tasa: ' + fmtRate(cop / php) + ' COP por ₱');
    if (php > 0 && usd > 0) parts.push(fmtRate(php / usd) + ' ₱/US$');
    if (cop > 0 && usd > 0) parts.push(fmtRate(cop / usd) + ' COP/US$');
    $('#fxFormRate').textContent = parts.join(' · ');
  }
  $('#fxForm').addEventListener('input', updateFxFormRate);

  $('#fxDialog').addEventListener('close', () => {
    if ($('#fxDialog').returnValue !== 'save') return;
    const f = $('#fxForm');
    const t = {
      date: f.date.value,
      php: Math.round(parseFloat(f.php.value) * 100) / 100,
      usd: parseFloat(f.usd.value) > 0 ? Math.round(parseFloat(f.usd.value) * 100) / 100 : null,
      cop: Math.round(parseFloat(f.cop.value) * 100) / 100,
    };
    if (!t.date || !(t.php > 0) || !(t.cop > 0)) return;
    const list = state.fx.transfers;
    if (editingFx) {
      const i = list.findIndex(x => x.id === editingFx);
      if (i >= 0) list[i] = Object.assign({ id: editingFx, source: list[i].source }, t);
    } else {
      t.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      list.push(t);
    }
    save();
    render();
    renderFx();
    toast('Transferencia guardada');
  });

  $('#fxDelete').addEventListener('click', () => {
    if (!editingFx || !confirm('¿Eliminar esta transferencia?')) return;
    state.fx.transfers = state.fx.transfers.filter(t => t.id !== editingFx);
    save();
    $('#fxDialog').close('deleted');
    render();
    renderFx();
    toast('Transferencia eliminada');
  });

  // ---------- Importar Excel ----------
  let workbook = null;
  let matrix = [];
  let rowOffset = 0; // fila de Excel donde empieza el rango de la hoja
  let parsed = { transactions: [], skipped: 0 };
  let sheetsCache = [];
  let quickChoices = {};

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('#fileInput').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });

  function readFile(file) {
    if (typeof XLSX === 'undefined') { toast('No se pudo cargar el lector de Excel.'); return; }
    $('#fileName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        workbook = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
      } catch (err) {
        toast('No se pudo leer el archivo: ' + err.message);
        return;
      }
      sheetsCache = workbook.SheetNames.map(name => ({ name, matrix: sheetMatrix(workbook.Sheets[name]) }));
      $('#sheetSelect').innerHTML = workbook.SheetNames.map(n => '<option>' + escapeHtml(n) + '</option>').join('');
      $('#importLedger').value = state.active;
      quickChoices = {};
      const quick = Parse.parseGastosPH(sheetsCache);
      $('#quickImport').classList.toggle('hidden', !quick);
      $('#importStep2').classList.toggle('hidden', !!quick);
      if (quick) {
        renderQuick();
      } else {
        loadSheet(true);
      }
      $(quick ? '#quickImport' : '#importStep2').scrollIntoView({ behavior: 'smooth' });
    };
    reader.readAsArrayBuffer(file);
  }

  function sheetMatrix(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  // --- Libro completo (Filipinas + Colombia + cambio) ---
  let quickParsed = null;

  function renderQuick() {
    quickParsed = Parse.parseGastosPH(sheetsCache, { extraColumns: quickChoices });
    const q = quickParsed;
    const phExp = q.ph.transactions.filter(t => t.type === 'expense');
    const coPaid = q.co.transactions.filter(t => t.type === 'expense' && !t.pending);
    const coPend = q.co.transactions.filter(t => t.pending);
    const months = txs => new Set(txs.map(t => t.date.slice(0, 7))).size;
    $('#quickSummary').innerHTML = [
      '🇵🇭 <b>Filipinas</b> (hoja “' + escapeHtml(q.ph.sheet) + '”): ' + q.ph.transactions.length + ' movimientos en ' + months(phExp) + ' meses, ' +
        Object.keys(q.ph.budgets).length + ' presupuestos (ESTIMADO).',
      '🇨🇴 <b>Colombia</b> (hoja “' + escapeHtml(q.co.sheet) + '”): ' + coPaid.length + ' pagos marcados con X por ' +
        fmtCo(coPaid.reduce((s, t) => s + t.amount, 0)) + (coPend.length ? ' y ' + coPend.length + ' pendientes por ' + fmtCo(coPend.reduce((s, t) => s + t.amount, 0)) : '') + '.',
      '⇄ <b>Cambio</b>: ' + q.fx.transfers.length + ' transferencias' + (q.fx.referenceRate ? ', tasa de referencia ' + fmtRate(q.fx.referenceRate) : '') + '.',
    ].map(li => '<li>' + li + '</li>').join('');

    const extras = q.ph.extras;
    const monthsOpts = Array.from({ length: 12 }, (_, i) => q.year + '-' + String(i + 1).padStart(2, '0'));
    $('#quickExtras').innerHTML = extras.length ? '<p class="hint">Columnas de Filipinas que no son un mes:</p>' +
      extras.map(e => '<label class="extra-col"><span>' + escapeHtml(e.label) + '</span><select data-quick-extra="' + e.index + '"><option value="">No importar</option>' +
        monthsOpts.map(k => '<option value="' + k + '"' + (quickChoices[e.index] === k ? ' selected' : '') + '>' + escapeHtml(monthLabel(k)) + '</option>').join('') +
        '</select></label>').join('') : '';
  }

  $('#quickExtras').addEventListener('change', e => {
    const sel = e.target.closest('[data-quick-extra]');
    if (!sel) return;
    if (sel.value) quickChoices[sel.dataset.quickExtra] = sel.value;
    else delete quickChoices[sel.dataset.quickExtra];
    renderQuick();
  });

  $('#quickManual').addEventListener('click', () => {
    $('#quickImport').classList.add('hidden');
    $('#importStep2').classList.remove('hidden');
    loadSheet(true);
  });

  // Reemplaza lo que vino antes de la misma hoja; lo agregado a mano se conserva.
  function syncInto(list, incoming, source) {
    return list.filter(t => t.source !== source).concat(incoming.map(t => Object.assign({}, t, { source })));
  }

  $('#quickImportBtn').addEventListener('click', () => {
    const q = quickParsed;
    if (!q) return;
    const ph = state.ledgers.ph, co = state.ledgers.co;
    ph.transactions = syncInto(ph.transactions, q.ph.transactions, 'libro:' + q.ph.sheet);
    Object.assign(ph.budgets, q.ph.budgets);
    co.transactions = syncInto(co.transactions, q.co.transactions, 'libro:' + q.co.sheet);
    state.fx.transfers = syncInto(state.fx.transfers, q.fx.transfers, 'libro:cambio');
    if (q.fx.referenceRate && !state.fx.referenceRate) state.fx.referenceRate = q.fx.referenceRate;
    save();
    $('#fxReference').value = state.fx.referenceRate || '';
    toast('Importado: Filipinas ' + q.ph.transactions.length + ', Colombia ' + q.co.transactions.length + ', ' + q.fx.transfers.length + ' transferencias');
    setLedger(state.active);
    setMonth(latestMonth() || currentMonth);
    showView('resumen');
  });

  // --- Importación manual (cualquier Excel) ---
  function loadSheet(autoDetect) {
    const ws = workbook.Sheets[$('#sheetSelect').value];
    matrix = sheetMatrix(ws);
    rowOffset = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
    $('#headerRow').min = rowOffset + 1;
    if (autoDetect) {
      $('#headerRow').value = Parse.guessHeaderRow(matrix) + 1 + rowOffset;
      guessLayoutAndMapping();
    } else {
      fillMapSelects();
    }
    updatePreview();
  }

  function headerIndex() { return Math.max(0, +$('#headerRow').value - 1 - rowOffset); }

  function headers() {
    const row = matrix[headerIndex()] || [];
    const width = matrix.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
    return Array.from({ length: width }, (_, i) => {
      const h = row[i];
      if (h instanceof Date) return h;
      return h == null || h === '' ? null : h;
    });
  }

  function colLetter(i) {
    let s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function headerLabel(h, i) {
    if (h instanceof Date) return colLetter(i) + ': ' + monthLabel(monthKey(h), true);
    return colLetter(i) + (Parse.isLabel(h) || Parse.parseMonthHeader(h) ? ': ' + String(h).trim() : '');
  }

  function fillMapSelects(mapping) {
    const hs = headers();
    const opts = '<option value="-1">— ninguna —</option>' + hs.map((h, i) => '<option value="' + i + '">' + escapeHtml(headerLabel(h, i)) + '</option>').join('');
    $$('[data-map]').forEach(sel => {
      const prev = sel.value;
      sel.innerHTML = opts;
      const want = mapping && mapping[sel.dataset.map] !== undefined ? mapping[sel.dataset.map] : prev;
      sel.value = want != null && want !== '' && +want < hs.length ? String(want) : '-1';
    });
  }

  function guessLayoutAndMapping() {
    const hs = headers();
    const monthHeaders = hs.filter(h => Parse.parseMonthHeader(h, true)).length;
    const guess = Parse.guessMapping(hs.map(h => (h instanceof Date ? '' : h)));
    const wide = monthHeaders >= 3 && guess.date < 0;
    $('#layoutSelect').value = wide ? 'wide' : 'rows';
    const wideCat = Parse.guessCategoryColumn(matrix, headerIndex());
    const wideBudget = Parse.findBudgetColumn(matrix, headerIndex(), wideCat);
    fillMapSelects(Object.assign({}, guess, { wideCategory: wideCat, wideBudget }));
    const yearFromHeader = hs.map(h => Parse.parseMonthHeader(h, true)).find(m => m && m.year);
    const sheetYear = /^(19|20)\d{2}$/.test($('#sheetSelect').value.trim()) ? +$('#sheetSelect').value.trim() : null;
    $('#wideYear').value = yearFromHeader ? yearFromHeader.year : sheetYear || new Date().getFullYear();
    extraChoices = {};
    guessEndRow();
    toggleLayout();
  }

  // Fila de Excel <-> índice en `matrix`.
  function excelRow(idx) { return idx + 1 + rowOffset; }
  function matrixIdx(row) { return row - 1 - rowOffset; }

  function guessEndRow() {
    const body = matrix.slice(headerIndex() + 1);
    const end = Parse.findTableEnd(body, currentMap().wideCategory, ['pagado']);
    $('#wideEndRow').value = excelRow(headerIndex() + end);
  }

  function toggleLayout() {
    const wide = $('#layoutSelect').value === 'wide';
    $('#mapRows').classList.toggle('hidden', wide);
    $('#mapWide').classList.toggle('hidden', !wide);
  }

  function currentMap() {
    const m = {};
    $$('[data-map]').forEach(sel => { m[sel.dataset.map] = +sel.value; });
    return m;
  }

  // Columnas que no son meses (p. ej. "Premiums and bonus"): el usuario elige a qué mes asignarlas.
  let extraChoices = {};

  function renderExtras(extras, year) {
    const box = $('#wideExtras');
    if (!extras.length) { box.innerHTML = ''; return; }
    const months = Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
    box.innerHTML = '<p class="hint">Columnas que no son un mes. Puedes sumarlas a un mes o dejarlas fuera:</p>' +
      extras.map(e => '<label class="extra-col"><span>' + colLetter(e.index) + ': ' + escapeHtml(e.label) + '</span>' +
        '<select data-extra="' + e.index + '"><option value="">No importar</option>' +
        months.map(k => '<option value="' + k + '"' + (extraChoices[e.index] === k ? ' selected' : '') + '>' + escapeHtml(monthLabel(k)) + '</option>').join('') +
        '</select></label>').join('');
  }

  $('#wideExtras').addEventListener('change', e => {
    const sel = e.target.closest('[data-extra]');
    if (!sel) return;
    if (sel.value) extraChoices[sel.dataset.extra] = sel.value;
    else delete extraChoices[sel.dataset.extra];
    updatePreview();
  });

  let parsedBudgets = {};
  const importCurrency = () => state.ledgers[$('#importLedger').value].currency;

  function updatePreview() {
    const map = currentMap();
    parsedBudgets = {};

    if ($('#layoutSelect').value === 'wide') {
      const endIdx = Math.max(headerIndex(), matrixIdx(+$('#wideEndRow').value || excelRow(matrix.length - 1)));
      const body = matrix.slice(headerIndex() + 1, endIdx + 1);
      const year = +$('#wideYear').value;
      renderExtras(Parse.findExtraColumns(headers(), body, map.wideCategory, map.wideBudget), year);
      parsed = Parse.wideToTransactions(headers(), body, map.wideCategory, year, { extraColumns: extraChoices, looseMonths: true });
      parsedBudgets = Parse.wideBudgets(body, map.wideCategory, map.wideBudget);
      const nb = Object.keys(parsedBudgets).length;
      const monthCols = parsed.monthColumns.filter(c => !c.label);
      $('#wideMonthsHint').textContent = (monthCols.length
        ? 'Meses detectados: ' + monthCols.map(c => colLetter(c.index) + ' (' + monthLabel(c.year + '-' + String(c.month + 1).padStart(2, '0'), true) + ')').join(', ') + '.'
        : 'No se detectaron columnas con nombres de mes (Enero, Feb, ENE 1A Q, 01/2026…).') +
        ' ' + parsed.categories + ' categorías.' + (nb ? ' Se tomarán ' + nb + ' presupuestos mensuales.' : '');
    } else {
      const body = matrix.slice(headerIndex() + 1);
      const hasNegatives = map.amount >= 0 && body.some(r => r && Parse.parseAmount(r[map.amount]) < 0);
      parsed = Parse.rowsToTransactions(body, map, { negativeMeans: $('#negativeMeans').value, hasNegatives });
    }

    const cur = importCurrency();
    const sample = parsed.transactions.slice(0, 8);
    $('#previewTable').innerHTML = '<thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th class="num">Monto</th></tr></thead><tbody>' +
      sample.map(t => '<tr><td>' + t.date + '</td><td>' + (t.type === 'income' ? 'Ingreso' : t.pending ? 'Pendiente' : 'Gasto') + '</td><td>' + escapeHtml(t.category) +
        '</td><td>' + escapeHtml(t.description) + '</td><td class="num">' + fmt(t.amount, cur) + '</td></tr>').join('') + '</tbody>';

    const n = parsed.transactions.length;
    const total = parsed.transactions.reduce((s, t) => s + (t.type === 'expense' && !t.pending ? t.amount : 0), 0);
    $('#previewSummary').textContent = n
      ? n + ' movimientos listos (gastos por ' + fmt(total, cur) + ').' + (parsed.skipped ? ' Se omitieron ' + parsed.skipped + ' filas sin fecha o monto válido.' : '')
      : 'No se encontraron movimientos. Revisa la fila de encabezados y las columnas elegidas.';
    $('#doImport').disabled = !n;
  }

  $('#sheetSelect').addEventListener('change', () => loadSheet(true));
  $('#importLedger').addEventListener('change', updatePreview);
  $('#headerRow').addEventListener('change', () => { fillMapSelects(); guessLayoutAndMapping(); updatePreview(); });
  $('#layoutSelect').addEventListener('change', () => { toggleLayout(); updatePreview(); });
  $$('[data-map]').forEach(s => s.addEventListener('change', () => {
    if (s.dataset.map === 'wideCategory') guessEndRow();
    updatePreview();
  }));
  $('#negativeMeans').addEventListener('change', updatePreview);
  $('#wideYear').addEventListener('change', () => { extraChoices = {}; updatePreview(); });
  $('#wideEndRow').addEventListener('change', updatePreview);

  $('#doImport').addEventListener('click', () => {
    const ledgerKey = $('#importLedger').value;
    const ledger = state.ledgers[ledgerKey];
    // `source` identifica la hoja de origen, para poder actualizarla al re-importar.
    const source = $('#layoutSelect').value + ':' + $('#sheetSelect').value;
    const incoming = parsed.transactions.map(t => Object.assign({}, t, { source }));
    if (!incoming.length) return;
    const mode = $('#importMode').value;
    let msg;
    if (mode === 'replace') {
      if (ledger.transactions.length && !confirm('Se reemplazarán ' + ledger.transactions.length + ' movimientos de ' + ledger.name + '. ¿Continuar?')) return;
      ledger.transactions = incoming;
      msg = incoming.length + ' movimientos importados';
    } else if (mode === 'sync') {
      const before = ledger.transactions.filter(t => t.source === source).length;
      ledger.transactions = syncInto(ledger.transactions, incoming, source);
      msg = before ? 'Hoja actualizada: ' + incoming.length + ' movimientos (antes ' + before + ')' : incoming.length + ' movimientos importados';
    } else {
      const ids = new Set(ledger.transactions.map(t => t.id));
      const fresh = incoming.filter(t => !ids.has(t.id));
      ledger.transactions = ledger.transactions.concat(fresh);
      msg = fresh.length + ' movimientos importados' + (fresh.length < incoming.length ? ' (' + (incoming.length - fresh.length) + ' ya existían)' : '');
    }
    const nb = Object.keys(parsedBudgets).length;
    if (nb) {
      Object.assign(ledger.budgets, parsedBudgets);
      msg += ' y ' + nb + ' presupuestos';
    }
    save();
    toast(msg + ' en ' + ledger.name);
    setLedger(ledgerKey);
    setMonth(latestMonth(incoming) || currentMonth);
    showView('resumen');
  });

  // ---------- Presupuestos ----------
  function renderBudgetForm() {
    const cats = allCategories();
    // Sugerencia: promedio de los últimos 3 meses con gasto en la categoría.
    const avg = {};
    for (const c of cats) {
      const vals = [1, 2, 3].map(i => txOfMonth(shiftMonth(currentMonth, -i)).filter(t => t.type === 'expense' && !t.pending && t.category === c).reduce((s, t) => s + t.amount, 0)).filter(v => v > 0);
      avg[c] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    $('#budgetForm').innerHTML = cats.length ? cats.map(c =>
      '<label class="budget-input"><span>' + escapeHtml(c) + (avg[c] ? '<small>prom. 3 meses: ' + fmt(avg[c]) + '</small>' : '') + '</span>' +
      '<input type="number" min="0" step="1" inputmode="decimal" data-cat="' + escapeHtml(c) + '" value="' + (L().budgets[c] || '') + '" placeholder="Sin límite"></label>'
    ).join('') : '<p class="hint">Aún no hay categorías en ' + escapeHtml(L().name) + '. Importa tu Excel o agrega una.</p>';
  }

  $('#budgetForm').addEventListener('change', e => {
    const input = e.target.closest('input[data-cat]');
    if (!input) return;
    const v = parseFloat(input.value);
    if (v > 0) L().budgets[input.dataset.cat] = v;
    else delete L().budgets[input.dataset.cat];
    save();
    renderDashboard();
  });

  $('#addCategoryBtn').addEventListener('click', () => {
    const name = $('#newCategory').value.trim();
    if (!name) return;
    if (!L().categories.includes(name)) L().categories.push(name);
    $('#newCategory').value = '';
    save();
    renderBudgetForm();
    renderCategoryOptions();
  });

  // ---------- Ajustes ----------
  function renderSettings() {
    $$('[data-currency]').forEach(sel => {
      sel.innerHTML = CURRENCIES.map(([code, name]) => '<option value="' + code + '">' + escapeHtml(name) + '</option>').join('');
      sel.value = state.ledgers[sel.dataset.currency].currency;
    });
    $('#fxReference').value = state.fx.referenceRate || '';
  }
  $$('[data-currency]').forEach(sel => sel.addEventListener('change', () => {
    state.ledgers[sel.dataset.currency].currency = sel.value;
    save();
    render();
  }));
  $('#fxReference').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    state.fx.referenceRate = v > 0 ? v : null;
    save();
  });

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  $('#exportJson').addEventListener('click', () => {
    download('mis-gastos-' + Parse.toISODate(new Date()) + '.json', new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  });

  $('#importJson').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(text => {
      const data = JSON.parse(text);
      if (!data.ledgers && !Array.isArray(data.transactions)) throw new Error('formato no válido');
      if (!confirm('Se reemplazarán los datos actuales por la copia. ¿Continuar?')) return;
      state = normalizeState(data);
      save();
      renderSettings();
      setLedger(state.active);
      setMonth(latestMonth() || currentMonth);
      toast('Copia restaurada');
    }).catch(err => toast('No se pudo restaurar: ' + err.message));
  });

  $('#exportXlsx').addEventListener('click', () => {
    const wb = XLSX.utils.book_new();
    for (const key of ['ph', 'co']) {
      const lg = state.ledgers[key];
      const rows = lg.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => ({
        Fecha: t.date, Tipo: t.type === 'income' ? 'Ingreso' : 'Gasto', Estado: t.pending ? 'Pendiente' : 'Pagado',
        Categoría: t.category, Descripción: t.description, ['Monto ' + lg.currency]: t.amount,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), lg.name);
      const budgets = Object.entries(lg.budgets).map(([c, v]) => ({ Categoría: c, ['Presupuesto mensual ' + lg.currency]: v }));
      if (budgets.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(budgets), 'Presupuestos ' + lg.name);
    }
    const fx = fxRows().map(r => ({
      Fecha: r.date, 'Enviado PHP': r.php, 'US$': r.usd, 'Recibido COP': r.cop, 'COP por PHP': Math.round(r.rate * 10000) / 10000,
      'Gastado COP': r.spent, 'Saldo COP': r.balance,
    }));
    if (fx.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fx), 'Cambio');
    XLSX.writeFile(wb, 'mis-gastos-' + Parse.toISODate(new Date()) + '.xlsx');
  });

  $('#clearAll').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los datos de ambos controladores y del cambio en este dispositivo?')) return;
    state = defaultState();
    save();
    renderSettings();
    setLedger('ph');
    toast('Datos borrados');
  });

  // Redibujar los gráficos si cambia el tema claro/oscuro.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderSettings();
  setLedger(state.active);
  setMonth(currentMonth);
})();
