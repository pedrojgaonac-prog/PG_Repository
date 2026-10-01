(function () {
  'use strict';

  // Vista previa del nuevo diseño: usa su propia copia de los datos (v3), creada a partir
  // de los de la app actual (v2), para poder probarla sin tocar nada.
  const STORAGE_KEY = 'misGastos.v3';
  const OLDER_KEYS = ['misGastos.v2', 'misGastos.v1'];
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const CURRENCIES = [
    ['PHP', 'Peso filipino (₱)'], ['COP', 'Peso colombiano ($)'], ['USD', 'Dólar (US$)'], ['EUR', 'Euro (€)'],
    ['MXN', 'Peso mexicano'], ['CLP', 'Peso chileno'], ['ARS', 'Peso argentino'], ['PEN', 'Sol peruano'], ['GBP', 'Libra (£)'],
  ];
  const TITLES = { inicio: 'Inicio', gastos: 'Gastos', ahorro: 'Ahorro', cambio: 'Cambio', mas: 'Más', presupuestos: 'Presupuestos', importar: 'Importar Excel' };
  const SUBVIEWS = { presupuestos: 'mas', importar: 'mas' };

  // ---------- Estado ----------
  const emptyLedger = (name, flag, currency) => ({ name, flag, currency, transactions: [], budgets: {}, categories: [], opening: 0 });
  const defaultState = () => ({
    version: 3,
    active: 'ph',
    ledgers: { ph: emptyLedger('Filipinas', '🇵🇭', 'PHP'), co: emptyLedger('Colombia', '🇨🇴', 'COP') },
    fx: { transfers: [], referenceRate: null },
    savings: { moves: [], cdts: [] },
    lastBackup: null,
  });

  function normalizeState(data) {
    const st = defaultState();
    if (data && data.ledgers) {
      for (const k of ['ph', 'co']) Object.assign(st.ledgers[k], data.ledgers[k] || {});
      st.active = data.active === 'co' ? 'co' : 'ph';
      Object.assign(st.fx, data.fx || {});
      Object.assign(st.savings, data.savings || {});
      st.lastBackup = data.lastBackup || null;
    } else if (data && Array.isArray(data.transactions)) {
      Object.assign(st.ledgers.ph, {
        transactions: data.transactions, budgets: data.budgets || {}, categories: data.categories || [],
        currency: (data.settings && data.settings.currency) || 'PHP',
      });
    }
    return st;
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) for (const k of OLDER_KEYS) { raw = localStorage.getItem(k); if (raw) break; }
      return normalizeState(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('No se pudo guardar: el almacenamiento está lleno o bloqueado.');
    }
  }

  let state = load();
  const L = () => state.ledgers[state.active];
  let currentView = 'inicio';
  let catFilter = '';
  const charts = {};

  // ---------- Utilidades ----------
  const pad2 = n => String(n).padStart(2, '0');
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }
  const todayKey = () => monthKey(new Date());
  const todayISO = () => Parse.toISODate(new Date());

  function latestMonth(txs) {
    let max = '', maxAny = '';
    for (const t of txs) {
      if (t.extra) continue;
      const k = t.date.slice(0, 7);
      if (k > maxAny) maxAny = k;
      if (t.type === 'expense' && k > max) max = k;
    }
    return max || maxAny;
  }
  // Mes inicial: el actual si tiene gastos; si no, el último con gastos en cualquier controlador.
  function initialMonth() {
    const all = state.ledgers.ph.transactions.concat(state.ledgers.co.transactions);
    const last = latestMonth(all);
    return last && last < todayKey() && !all.some(t => !t.extra && t.type === 'expense' && t.date.startsWith(todayKey())) ? last : todayKey();
  }
  let currentMonth = initialMonth();

  function monthLabel(key, short) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es', short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
  }

  function fmt(n, currency) {
    currency = currency || L().currency;
    const decimals = Math.abs(n) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat('es', {
        style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'narrowSymbol',
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(n);
    } catch (e) {
      return n.toFixed(decimals);
    }
  }
  const fmtPh = n => fmt(n, state.ledgers.ph.currency);
  const fmtCo = n => fmt(n, state.ledgers.co.currency);
  const fmtRate = n => n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Montos compactos para tarjetas pequeñas: "49,1 M $".
  function fmtShort(n, currency) {
    const sym = fmt(0, currency).replace(/[\d\s.,]/g, '');
    if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('es', { maximumFractionDigits: 1 }) + ' M ' + sym;
    if (Math.abs(n) >= 1e5) return Math.round(n / 1e3).toLocaleString('es') + ' mil ' + sym;
    return fmt(n, currency);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- Cálculos ----------
  const regular = t => !t.extra;
  function txOfMonth(key, lg) { return (lg || L()).transactions.filter(t => regular(t) && t.date.startsWith(key)); }
  function sumBy(txs, type) { return txs.reduce((s, t) => s + (t.type === type && !t.pending ? t.amount : 0), 0); }
  const sumPending = txs => txs.reduce((s, t) => s + (t.type === 'expense' && t.pending ? t.amount : 0), 0);
  const budgetTotal = lg => Object.values(lg.budgets).reduce((s, v) => s + (v || 0), 0);
  function transfersOfMonth(key) { return state.fx.transfers.filter(t => t.date.startsWith(key)); }

  function incomeOfMonth(key, lgKey) {
    const lg = state.ledgers[lgKey];
    const own = sumBy(txOfMonth(key, lg), 'income');
    return lgKey === 'co' ? own + transfersOfMonth(key).reduce((s, t) => s + t.cop, 0) : own;
  }

  function savingsTotals() {
    const moves = state.savings.moves;
    const fin = moves.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    const fout = moves.filter(m => m.type === 'out' && !m.invest).reduce((s, m) => s + m.amount, 0);
    const finv = moves.filter(m => m.type === 'out' && m.invest).reduce((s, m) => s + m.amount, 0);
    const years = state.savings.cdts.map(c => c.year);
    const cdtYear = years.length ? Math.max.apply(null, years) : null;
    const cdt = state.savings.cdts.filter(c => c.year === cdtYear).reduce((s, c) => s + c.amount, 0);
    return { fin, fout, finv, fund: fin - fout - finv, cdt, cdtYear };
  }

  // Saldo de cada controlador hasta hoy: saldo inicial + ingresos (y traslados) − gastos pagados.
  // En Filipinas solo cuentan los meses con gastos registrados (los sueldos futuros son proyección).
  function balances() {
    const today = todayISO();
    const co = state.ledgers.co, ph = state.ledgers.ph;
    const coIn = co.transactions.filter(t => t.type === 'income' && t.date <= today).reduce((s, t) => s + t.amount, 0);
    const coOut = co.transactions.filter(t => t.type === 'expense' && !t.pending && t.date <= today).reduce((s, t) => s + t.amount, 0);
    const coTr = state.fx.transfers.filter(t => t.date <= today).reduce((s, t) => s + t.cop, 0);
    const coAvail = (co.opening || 0) + coTr + coIn - coOut;

    const year = new Date().getFullYear();
    const phYear = ph.transactions.filter(t => t.date.startsWith(String(year)));
    const months = new Set(phYear.filter(t => regular(t) && t.type === 'expense').map(t => t.date.slice(0, 7)));
    const counts = t => !t.pending && (t.extra || months.has(t.date.slice(0, 7)));
    const phRes = (ph.opening || 0) + phYear.reduce((s, t) => s + (counts(t) ? (t.type === 'income' ? t.amount : -t.amount) : 0), 0);
    const phSaving = phYear.filter(t => t.type === 'expense' && !t.pending && /^ahorro/i.test(t.category)).reduce((s, t) => s + t.amount, 0);
    return { coAvail, phRes, phSaving, year };
  }

  // ---------- Navegación ----------
  function showView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + name));
    const tab = SUBVIEWS[name] || name;
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === tab));
    $('#viewTitle').textContent = TITLES[name];
    $('#backBtn').classList.toggle('hidden', !SUBVIEWS[name]);
    $('#monthNav').classList.toggle('hidden', !['inicio', 'gastos', 'cambio'].includes(name));
    $('#fabAdd').classList.toggle('hidden', !['inicio', 'gastos'].includes(name));
    render();
    window.scrollTo(0, 0);
  }
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));
  $('#backBtn').addEventListener('click', () => showView(SUBVIEWS[currentView] || 'inicio'));
  $('#heroSavings').addEventListener('click', () => showView('ahorro'));
  $$('[data-open-ledger]').forEach(b => b.addEventListener('click', () => { setLedger(b.dataset.openLedger); showView('gastos'); }));

  function setLedger(key) {
    state.active = key;
    catFilter = '';
    save();
    $$('#ledgerSeg button, #ledgerSegB button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ledger === key)));
    $('#importLedger').value = key;
    render();
  }
  $$('#ledgerSeg button, #ledgerSegB button').forEach(b => b.addEventListener('click', () => setLedger(b.dataset.ledger)));

  function setMonth(key) {
    currentMonth = key;
    $('#monthInput').value = key;
    const [y, m] = key.split('-').map(Number);
    $('#monthLabel').textContent = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'short' }).replace('.', '') + ' ' + y;
    render();
  }
  $('#prevMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, -1)));
  $('#nextMonth').addEventListener('click', () => setMonth(shiftMonth(currentMonth, 1)));
  $('#monthInput').addEventListener('change', e => { if (e.target.value) setMonth(e.target.value); });

  function render() {
    renderBackupInfo();
    if (currentView === 'inicio') renderInicio();
    if (currentView === 'gastos') renderGastos();
    if (currentView === 'ahorro') renderAhorro();
    if (currentView === 'cambio') renderFx();
    if (currentView === 'presupuestos') renderBudgetForm();
  }

  // ---------- Inicio ----------
  function renderInicio() {
    const hasData = state.ledgers.ph.transactions.length + state.ledgers.co.transactions.length + state.savings.moves.length > 0;
    $('#emptyState').classList.toggle('hidden', hasData);

    const sv = savingsTotals();
    const b = balances();
    $('#hSavings').textContent = fmtCo(sv.fund + sv.cdt);
    $('#hSavingsSub').textContent = 'Fondo de primas ' + fmtShort(sv.fund, state.ledgers.co.currency) + ' · CDT ' + fmtShort(sv.cdt, state.ledgers.co.currency);

    $('#bCo').textContent = fmtCo(b.coAvail + sv.fund);
    $('#bCoSub').textContent = 'Disponible ' + fmtShort(b.coAvail, state.ledgers.co.currency) + ' · Primas ' + fmtShort(sv.fund, state.ledgers.co.currency);
    $('#bPhYear').textContent = b.year;
    $('#bPh').textContent = fmtPh(b.phRes);
    $('#bPh').classList.toggle('bad', b.phRes < 0);
    $('#bPhSub').textContent = 'Resultado del año' + (b.phSaving ? ' · Ahorro ' + fmtShort(b.phSaving, state.ledgers.ph.currency) : '');

    $('#monthCards').innerHTML = ['ph', 'co'].map(k => {
      const lg = state.ledgers[k];
      const txs = txOfMonth(currentMonth, lg);
      const spent = sumBy(txs, 'expense');
      const pend = sumPending(txs);
      const budget = budgetTotal(lg);
      const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
      const cls = !budget ? '' : spent > budget * 1.005 ? 'over' : spent > budget * 0.85 ? 'warn' : '';
      const sub = budget ? 'de ' + fmtShort(budget, lg.currency) + (spent <= budget ? ' · quedan ' + fmtShort(budget - spent, lg.currency) : ' · excedido') : 'Sin presupuesto';
      return '<button class="tile" data-open-ledger="' + k + '"><span class="tile-head">' + lg.flag + ' ' + escapeHtml(lg.name) + '</span>' +
        '<span class="tile-value">' + fmt(spent, lg.currency) + '</span>' +
        (budget ? '<div class="bar"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' : '') +
        '<span class="tile-sub">' + sub + '</span>' +
        (pend ? '<span class="tile-sub warn-text">Pendiente ' + fmtShort(pend, lg.currency) + '</span>' : '') + '</button>';
    }).join('');
    $$('#monthCards [data-open-ledger]').forEach(b => b.addEventListener('click', () => { setLedger(b.dataset.openLedger); showView('gastos'); }));

    // Pendientes de este mes y anteriores, de ambos controladores.
    const end = currentMonth + '-31';
    const pending = [];
    for (const k of ['ph', 'co']) for (const t of state.ledgers[k].transactions) if (t.pending && t.date <= end) pending.push({ k, t });
    pending.sort((a, b) => a.t.date.localeCompare(b.t.date) || b.t.amount - a.t.amount);
    $('#pendingBox').classList.toggle('hidden', !pending.length);
    $('#pendingCount').textContent = pending.length || '';
    $('#pendingList').innerHTML = pending.slice(0, 12).map(({ k, t }) => {
      const lg = state.ledgers[k];
      const late = t.date.slice(0, 7) < currentMonth;
      return '<label class="pend"><input type="checkbox" data-pay="' + k + ':' + t.id + '" aria-label="Marcar como pagado">' +
        '<span class="tx-main"><span class="tx-title">' + escapeHtml(t.description || t.category) + '</span>' +
        '<span class="tx-sub">' + lg.flag + ' ' + (late ? '<span class="badge">' + escapeHtml(monthLabel(t.date.slice(0, 7), true)) + '</span>' : '') + escapeHtml(t.description ? t.category : '') + '</span></span>' +
        '<span class="tx-amt">' + fmt(t.amount, lg.currency) + '</span></label>';
    }).join('') + (pending.length > 12 ? '<p class="empty-note">y ' + (pending.length - 12) + ' más en Gastos.</p>' : '');
  }

  $('#pendingList').addEventListener('change', e => {
    const cb = e.target.closest('[data-pay]');
    if (!cb) return;
    const [k, id] = cb.dataset.pay.split(':');
    const t = state.ledgers[k].transactions.find(x => x.id === id);
    if (!t) return;
    delete t.pending;
    save();
    toast('Pagado: ' + (t.description || t.category));
    setTimeout(render, 250);
  });

  // ---------- Gastos ----------
  function renderGastos() {
    const lg = L();
    const txs = txOfMonth(currentMonth);
    const spent = sumBy(txs, 'expense');
    const pend = sumPending(txs);
    const income = incomeOfMonth(currentMonth, state.active);
    const prev = sumBy(txOfMonth(shiftMonth(currentMonth, -1)), 'expense');
    const budget = budgetTotal(lg);

    $('#gSpent').textContent = fmt(spent);
    const d = $('#gDelta');
    if (prev > 0) {
      const pct = ((spent - prev) / prev) * 100;
      d.textContent = (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '% vs. mes ant.';
      d.className = 'delta ' + (pct > 0 ? 'bad' : 'good');
    } else {
      d.textContent = '';
      d.className = 'delta hidden';
    }
    $('#gBar').classList.toggle('hidden', !budget);
    if (budget) {
      const fill = $('#gBarFill');
      fill.style.width = Math.min(100, (spent / budget) * 100) + '%';
      fill.className = 'bar-fill ' + (spent > budget * 1.005 ? 'over' : spent > budget * 0.85 ? 'warn' : '');
      $('#gBudget').textContent = Math.round((spent / budget) * 100) + '% de ' + fmt(budget) + (spent <= budget ? ' · quedan ' + fmt(budget - spent) : ' · excedido por ' + fmt(spent - budget));
    } else {
      $('#gBudget').textContent = 'Sin presupuesto definido (Más → Presupuestos)';
    }
    $('#gIncomeLabel').textContent = state.active === 'co' ? 'Recibido' : 'Ingresos';
    $('#gIncome').textContent = income ? fmtShort(income, lg.currency) : '–';
    $('#gBalance').textContent = income ? fmtShort(income - spent, lg.currency) : '–';
    $('#gBalance').className = income && income - spent < 0 ? 'bad' : '';
    $('#gPending').textContent = pend ? fmtShort(pend, lg.currency) : '–';
    $('#gPending').className = pend ? 'warn-text' : '';

    renderCategories(txs, budget);
    renderTxList(txs);
    if ($('#v-gastos details').open) renderTrend();
  }

  function renderCategories(txs) {
    const budgets = L().budgets;
    const by = {}, pend = {};
    for (const t of txs) if (t.type === 'expense') (t.pending ? pend : by)[t.category] = ((t.pending ? pend : by)[t.category] || 0) + t.amount;
    const cats = Array.from(new Set(Object.keys(by).concat(Object.keys(pend), Object.keys(budgets).filter(c => budgets[c] > 0))));
    cats.sort((a, b) => (by[b] || 0) - (by[a] || 0) || (pend[b] || 0) - (pend[a] || 0));
    $('#clearCat').classList.toggle('hidden', !catFilter);
    if (!cats.length) { $('#catList').innerHTML = '<p class="empty-note">Sin gastos en ' + escapeHtml(monthLabel(currentMonth)) + '.</p>'; return; }
    $('#catList').innerHTML = cats.map(c => {
      const spent = by[c] || 0, budget = budgets[c] || 0;
      const cls = !budget ? '' : spent > budget * 1.005 ? 'over' : spent > budget * 0.85 ? 'warn' : '';
      const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
      return '<button class="cat ' + cls + (catFilter === c ? ' selected' : '') + '" data-cat="' + escapeHtml(c) + '">' +
        '<div class="cat-head"><span class="cat-name">' + escapeHtml(c) + '</span><span class="cat-amt">' + fmt(spent) + (budget ? ' <small>/ ' + fmt(budget) + '</small>' : '') + '</span></div>' +
        (budget ? '<div class="bar"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' : '') +
        (pend[c] ? '<span class="tx-sub"><span class="badge">pendiente</span>' + fmt(pend[c]) + '</span>' : '') + '</button>';
    }).join('');
  }
  $('#catList').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    catFilter = catFilter === b.dataset.cat ? '' : b.dataset.cat;
    renderGastos();
    if (catFilter) $('#txTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#clearCat').addEventListener('click', () => { catFilter = ''; renderGastos(); });

  function initial(s) { return (String(s).trim()[0] || '·').toUpperCase(); }

  function renderTxList(txs) {
    const q = Parse.normalize($('#txSearch').value);
    const list = txs.filter(t => (!catFilter || t.category === catFilter) && (!q || Parse.normalize(t.description + ' ' + t.category).includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
    $('#txTitle').textContent = catFilter ? catFilter : 'Movimientos';
    if (!list.length) { $('#txList').innerHTML = '<p class="empty-note">No hay movimientos.</p>'; return; }
    $('#txList').innerHTML = list.map(t => {
      const d = new Date(t.date + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' });
      return '<button class="tx" data-id="' + t.id + '"><span class="tx-icon">' + escapeHtml(initial(t.category)) + '</span>' +
        '<span class="tx-main"><span class="tx-title">' + escapeHtml(t.description || t.category) + '</span>' +
        '<span class="tx-sub">' + (t.pending ? '<span class="badge">pendiente</span>' : '') + escapeHtml(d) + (t.description ? ' · ' + escapeHtml(t.category) : '') + '</span></span>' +
        '<span class="tx-amt ' + t.type + (t.pending ? ' pending' : '') + '">' + (t.type === 'income' ? '+' : '−') + fmt(t.amount) + '</span></button>';
    }).join('');
  }
  $('#txSearch').addEventListener('input', () => renderTxList(txOfMonth(currentMonth)));
  $('#txList').addEventListener('click', e => {
    const b = e.target.closest('.tx');
    if (b) openTxDialog(L().transactions.find(t => t.id === b.dataset.id));
  });
  $('#v-gastos details').addEventListener('toggle', e => { if (e.target.open) renderTrend(); });

  function chartDefaults() {
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  }
  const shortTick = f => v => f(v).replace(/[.,]00(?=\D*$)/, '');

  function renderTrend() {
    if (typeof Chart === 'undefined') return;
    chartDefaults();
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
    const accent = cssVar('--accent');
    const data = months.map(k => sumBy(txOfMonth(k), 'expense'));
    charts.trend && charts.trend.destroy();
    charts.trend = new Chart($('#chartTrend'), {
      type: 'bar',
      data: { labels: months.map(k => monthLabel(k, true)), datasets: [{ label: 'Gastado', data, borderRadius: 4, maxBarThickness: 28, backgroundColor: months.map(k => (k === currentMonth ? accent : accent + '66')) }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed.y) } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: cssVar('--border') }, border: { display: false }, ticks: { callback: shortTick(v => fmtShort(v, L().currency)) } } },
        onClick: (_, els) => { if (els.length) setMonth(months[els[0].index]); },
      },
    });
  }

  // Repite los gastos del mes anterior como pendientes (gastos fijos).
  $('#repeatMonthBtn').addEventListener('click', () => {
    const prevKey = shiftMonth(currentMonth, -1);
    const prev = txOfMonth(prevKey).filter(t => t.type === 'expense');
    if (!prev.length) { toast('No hay gastos en ' + monthLabel(prevKey)); return; }
    const key = t => Parse.normalize(t.category + '|' + t.description);
    const have = new Set(txOfMonth(currentMonth).filter(t => t.type === 'expense').map(key));
    const [y, m] = currentMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const copies = prev.filter(t => !have.has(key(t))).map(t => ({
      id: newId('m'), date: currentMonth + '-' + pad2(Math.min(+t.date.slice(8, 10), lastDay)),
      amount: t.amount, type: 'expense', category: t.category, description: t.description, pending: true,
    }));
    if (!copies.length) { toast('Los gastos de ' + monthLabel(prevKey) + ' ya están en este mes'); return; }
    if (!confirm('Se agregarán ' + copies.length + ' gastos de ' + monthLabel(prevKey) + ' como pendientes. ¿Continuar?')) return;
    L().transactions = L().transactions.concat(copies);
    save();
    render();
    toast(copies.length + ' gastos agregados como pendientes');
  });

  // ---------- Diálogo de movimiento ----------
  let editing = null; // { id, ledger }
  let dialogLedger = 'ph';

  function setDialogLedger(k) {
    dialogLedger = k;
    $$('#txLedgerSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ledger === k)));
    $('#txCurrency').textContent = fmt(0, state.ledgers[k].currency).replace(/[\d\s.,]/g, '') || state.ledgers[k].currency;
    const lg = state.ledgers[k];
    const cats = Array.from(new Set(lg.transactions.map(t => t.category).concat(lg.categories, Object.keys(lg.budgets)))).sort((a, b) => a.localeCompare(b, 'es'));
    $('#categoryOptions').innerHTML = cats.map(c => '<option value="' + escapeHtml(c) + '">').join('');
    // Atajos: las categorías más usadas en los últimos 60 días.
    const since = Parse.toISODate(new Date(Date.now() - 60 * 864e5));
    const freq = {};
    lg.transactions.forEach(t => { if (t.type === 'expense' && t.date >= since) freq[t.category] = (freq[t.category] || 0) + 1; });
    const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 8);
    const chips = top.length ? top : cats.slice(0, 8);
    $('#catChips').innerHTML = chips.map(c => '<button type="button" data-chip="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>').join('');
  }
  function setDialogType(type) {
    $('#txForm').type.value = type;
    $$('#txTypeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
  }
  $$('#txLedgerSeg button').forEach(b => b.addEventListener('click', () => setDialogLedger(b.dataset.ledger)));
  $$('#txTypeSeg button').forEach(b => b.addEventListener('click', () => setDialogType(b.dataset.type)));
  $('#catChips').addEventListener('click', e => { const c = e.target.closest('[data-chip]'); if (c) $('#txForm').category.value = c.dataset.chip; });

  function defaultDate() { return currentMonth === todayKey() ? todayISO() : currentMonth + '-01'; }

  function openTxDialog(tx, ledgerKey) {
    const f = $('#txForm');
    const k = ledgerKey || state.active;
    editing = tx ? { id: tx.id, ledger: k } : null;
    $('#txDialogTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo gasto';
    $('#txLedgerSeg').classList.toggle('hidden', !!tx);
    setDialogLedger(k);
    setDialogType(tx ? tx.type : 'expense');
    f.date.value = tx ? tx.date : defaultDate();
    f.amount.value = tx ? tx.amount : '';
    f.category.value = tx ? tx.category : '';
    f.description.value = tx ? tx.description : '';
    f.pending.checked = !!(tx && tx.pending);
    f.extra.checked = !!(tx && tx.extra);
    $('#txDelete').classList.toggle('hidden', !tx);
    $('#txDialog').returnValue = '';
    $('#txDialog').showModal();
    if (!tx) setTimeout(() => f.amount.focus(), 50);
  }
  $('#fabAdd').addEventListener('click', () => openTxDialog(null, currentView === 'gastos' ? state.active : state.active));

  $('#txDialog').addEventListener('close', () => {
    if ($('#txDialog').returnValue !== 'save') return;
    const f = $('#txForm');
    const tx = {
      date: f.date.value,
      amount: Math.round(parseFloat(f.amount.value) * 100) / 100,
      type: f.type.value || 'expense',
      category: f.category.value.trim() || 'Sin categoría',
      description: f.description.value.trim(),
    };
    if (f.pending.checked && tx.type === 'expense') tx.pending = true;
    if (f.extra.checked) tx.extra = true;
    if (!tx.date || !(tx.amount > 0)) return;
    if (editing) {
      const list = state.ledgers[editing.ledger].transactions;
      const i = list.findIndex(t => t.id === editing.id);
      if (i >= 0) list[i] = Object.assign({ id: editing.id, source: list[i].source }, tx);
    } else {
      tx.id = newId('m');
      state.ledgers[dialogLedger].transactions.push(tx);
      if (dialogLedger !== state.active) setLedger(dialogLedger);
    }
    save();
    render();
    toast('Guardado');
  });

  $('#txDelete').addEventListener('click', () => {
    if (!editing || !confirm('¿Eliminar este movimiento?')) return;
    const lg = state.ledgers[editing.ledger];
    lg.transactions = lg.transactions.filter(t => t.id !== editing.id);
    save();
    $('#txDialog').close('deleted');
    render();
    toast('Eliminado');
  });

  // ---------- Ahorro ----------
  function renderAhorro() {
    const sv = savingsTotals();
    const co = state.ledgers.co.currency;
    $('#aTotal').textContent = fmtCo(sv.fund + sv.cdt);
    $('#fIn').textContent = fmtShort(sv.fin, co);
    $('#fOut').textContent = fmtShort(sv.fout, co);
    $('#fInv').textContent = fmtShort(sv.finv, co);
    $('#fBal').textContent = fmtShort(sv.fund, co);

    const parts = [['Usado', sv.fout, '--s-out'], ['A inversión', sv.finv, '--s-inv'], ['Saldo', Math.max(0, sv.fund), '--s-bal']];
    const total = parts.reduce((s, p) => s + p[1], 0);
    $('#fStack').innerHTML = total ? parts.filter(p => p[1] > 0).map(p => '<span title="' + p[0] + ': ' + fmtCo(p[1]) + '" style="flex:' + p[1] + ';background:var(' + p[2] + ')"></span>').join('') : '';
    $('#fLegend').innerHTML = total ? parts.map(p => '<span><i style="background:var(' + p[2] + ')"></i>' + p[0] + ' ' + Math.round((p[1] / total) * 100) + '%</span>').join('') : '';

    const moves = state.savings.moves.slice().sort((a, b) => b.date.localeCompare(a.date) || (a.type === 'in' ? -1 : 1));
    $('#moveList').innerHTML = moves.length ? moves.map(m => {
      const kind = m.type === 'in' ? 'in' : m.invest ? 'invest' : 'out';
      const sym = { in: '+', out: '−', invest: '→' }[kind];
      const label = { in: 'Aporte', out: 'Uso', invest: 'A inversión' }[kind];
      return '<button class="tx" data-move="' + m.id + '"><span class="move-icon ' + kind + '">' + sym + '</span>' +
        '<span class="tx-main"><span class="tx-title">' + escapeHtml(m.concept) + '</span><span class="tx-sub">' + label + ' · ' +
        escapeHtml(new Date(m.date + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })) + '</span></span>' +
        '<span class="tx-amt ' + (kind === 'in' ? 'income' : '') + '">' + (kind === 'in' ? '+' : '−') + fmtCo(m.amount) + '</span></button>';
    }).join('') : '<p class="empty-note">Aún no hay movimientos. Agrega tu primera prima o bono.</p>';

    // CDT por año (el más reciente primero).
    const years = Array.from(new Set(state.savings.cdts.map(c => c.year))).sort((a, b) => b - a);
    $('#cdtList').innerHTML = years.length ? years.map(y => {
      const items = state.savings.cdts.filter(c => c.year === y);
      const tot = items.reduce((s, c) => s + c.amount, 0);
      return '<div class="cdt-year"><span>' + y + (y === sv.cdtYear ? ' · vigente' : '') + '</span><b>' + fmtCo(tot) + '</b></div><div class="list">' +
        items.map(c => '<button class="row" data-cdt="' + c.id + '"><span>' + escapeHtml(c.name) + '</span><span class="tx-amt">' + fmtCo(c.amount) + '</span></button>').join('') + '</div>';
    }).join('') : '<p class="empty-note">Sin inversiones registradas.</p>';

    renderPhBonus();
    const b = balances();
    const lgPh = state.ledgers.ph;
    const months = new Set(lgPh.transactions.filter(t => regular(t) && /^ahorro/i.test(t.category) && t.date.startsWith(String(b.year)) && !t.pending).map(t => t.date.slice(0, 7)));
    $('#phMonthlySaving').innerHTML = b.phSaving
      ? '<div class="flow"><div class="flow-row"><span>Categoría "Ahorro" en ' + b.year + '</span><b>' + fmtPh(b.phSaving) + '</b></div>' +
        '<div class="flow-row total"><span>Promedio por mes (' + months.size + ' meses)</span><span>' + fmtPh(months.size ? lgPh.transactions.filter(t => regular(t) && /^ahorro/i.test(t.category) && t.date.startsWith(String(b.year)) && !t.pending).reduce((s, t) => s + t.amount, 0) / months.size : 0) + '</span></div></div>'
      : '<p class="empty-note">Anota tus aportes con la categoría "Ahorro" en Filipinas para verlos aquí.</p>';
  }

  // Prima en Filipinas: movimientos extraordinarios de Filipinas, agrupados como en tu Excel.
  function renderPhBonus() {
    const lg = state.ledgers.ph;
    const years = Array.from(new Set(lg.transactions.filter(t => t.extra).map(t => +t.date.slice(0, 4)))).sort((a, b) => b - a);
    const year = years[0];
    $('#phBonusYear').textContent = year || '';
    if (!year) { $('#phBonus').innerHTML = '<p class="empty-note">Sin primas registradas en Filipinas. Marca un ingreso como "Extraordinario" para seguirlo aquí.</p>'; return; }
    const ex = lg.transactions.filter(t => t.extra && t.date.startsWith(String(year)));
    const sum = f => ex.filter(f).reduce((s, t) => s + t.amount, 0);
    const isTax = t => /retenc|impuest|tax/i.test(t.category);
    const isSent = t => /colombia|transfer/i.test(t.category);
    const isSave = t => /^ahorro/i.test(t.category);
    const incomes = ex.filter(t => t.type === 'income').sort((a, b) => b.amount - a.amount);
    const gross = incomes.length ? incomes[0].amount : 0;
    const adjustments = sum(t => t.type === 'income') - gross;
    const tax = sum(t => t.type === 'expense' && isTax(t));
    const sent = sum(t => t.type === 'expense' && isSent(t));
    const saved = sum(t => t.type === 'expense' && isSave(t));
    const spent = sum(t => t.type === 'expense' && !isTax(t) && !isSent(t) && !isSave(t));
    const result = gross + adjustments - tax - sent - saved - spent;
    // Con un solo año de primas, todo lo recibido en el fondo corresponde a esa prima.
    const ins = state.savings.moves.filter(m => m.type === 'in');
    const fund = years.length === 1 ? ins.reduce((s, m) => s + m.amount, 0) : ins.filter(m => m.date.startsWith(String(year))).reduce((s, m) => s + m.amount, 0);
    const row = (label, v, cls) => '<div class="flow-row' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><span>' + v + '</span></div>';
    $('#phBonus').innerHTML =
      row('Prima bruta (' + escapeHtml(incomes[0] ? incomes[0].category : '') + ')', '<b>' + fmtPh(gross) + '</b>') +
      (adjustments ? row('Ajustes (' + escapeHtml(incomes.slice(1).map(t => t.category).join(', ')) + ')', '+' + fmtPh(adjustments)) : '') +
      row('Impuestos (retención)', '−' + fmtPh(tax)) +
      row('Gastos en Filipinas', '−' + fmtPh(spent)) +
      (saved ? row('Ahorro en Filipinas', '−' + fmtPh(saved)) : '') +
      '<div class="flow-row sent"><span>→ Enviado a Colombia</span><b>' + fmtPh(sent) + '</b>' +
      (fund && sent ? '<small>Llegó al fondo de primas: ' + fmtCo(fund) + ' (' + fmtRate(fund / sent) + ' COP por ₱)</small>' : '') + '</div>' +
      row('Queda en Filipinas', fmtPh(result), 'total');
  }

  // Movimientos del fondo
  let editingMove = null;
  function openMoveDialog(m) {
    const f = $('#moveForm');
    editingMove = m ? m.id : null;
    $('#moveDialogTitle').textContent = m ? 'Editar movimiento del fondo' : 'Movimiento del fondo';
    f.kind.value = m ? (m.type === 'in' ? 'in' : m.invest ? 'invest' : 'out') : 'in';
    f.concept.value = m ? m.concept : '';
    f.amount.value = m ? m.amount : '';
    f.date.value = m ? m.date : todayISO();
    $('#moveDelete').classList.toggle('hidden', !m);
    $('#moveDialog').returnValue = '';
    $('#moveDialog').showModal();
  }
  $('#addMove').addEventListener('click', () => openMoveDialog(null));
  $('#moveList').addEventListener('click', e => { const b = e.target.closest('[data-move]'); if (b) openMoveDialog(state.savings.moves.find(m => m.id === b.dataset.move)); });
  $('#moveDialog').addEventListener('close', () => {
    if ($('#moveDialog').returnValue !== 'save') return;
    const f = $('#moveForm');
    const m = { date: f.date.value, type: f.kind.value === 'in' ? 'in' : 'out', concept: f.concept.value.trim(), amount: Math.round(parseFloat(f.amount.value) * 100) / 100 };
    if (f.kind.value === 'invest') m.invest = true;
    if (!m.date || !m.concept || !(m.amount > 0)) return;
    const list = state.savings.moves;
    if (editingMove) {
      const i = list.findIndex(x => x.id === editingMove);
      if (i >= 0) list[i] = Object.assign({ id: editingMove, source: list[i].source }, m);
    } else {
      m.id = newId('s');
      list.push(m);
    }
    save();
    render();
    toast(m.invest ? 'Guardado. Recuerda registrar el CDT.' : 'Guardado');
  });
  $('#moveDelete').addEventListener('click', () => {
    if (!editingMove || !confirm('¿Eliminar este movimiento del fondo?')) return;
    state.savings.moves = state.savings.moves.filter(m => m.id !== editingMove);
    save();
    $('#moveDialog').close('deleted');
    render();
  });

  // CDT
  let editingCdt = null;
  function openCdtDialog(c) {
    const f = $('#cdtForm');
    editingCdt = c ? c.id : null;
    f.name.value = c ? c.name : '';
    f.year.value = c ? c.year : new Date().getFullYear();
    f.amount.value = c ? c.amount : '';
    $('#cdtDelete').classList.toggle('hidden', !c);
    $('#cdtDialog').returnValue = '';
    $('#cdtDialog').showModal();
  }
  $('#addCdt').addEventListener('click', () => openCdtDialog(null));
  $('#cdtList').addEventListener('click', e => { const b = e.target.closest('[data-cdt]'); if (b) openCdtDialog(state.savings.cdts.find(c => c.id === b.dataset.cdt)); });
  $('#cdtDialog').addEventListener('close', () => {
    if ($('#cdtDialog').returnValue !== 'save') return;
    const f = $('#cdtForm');
    const c = { name: f.name.value.trim(), year: +f.year.value, amount: Math.round(parseFloat(f.amount.value) * 100) / 100 };
    if (!c.name || !c.year || !(c.amount > 0)) return;
    const list = state.savings.cdts;
    if (editingCdt) {
      const i = list.findIndex(x => x.id === editingCdt);
      if (i >= 0) list[i] = Object.assign({ id: editingCdt, source: list[i].source }, c);
    } else {
      c.id = newId('c');
      list.push(c);
    }
    save();
    render();
  });
  $('#cdtDelete').addEventListener('click', () => {
    if (!editingCdt || !confirm('¿Eliminar esta inversión?')) return;
    state.savings.cdts = state.savings.cdts.filter(c => c.id !== editingCdt);
    save();
    $('#cdtDialog').close('deleted');
    render();
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
    const php = ts.reduce((s, t) => s + t.php, 0), cop = ts.reduce((s, t) => s + t.cop, 0), usd = ts.reduce((s, t) => s + (t.usd || 0), 0);
    return { php, cop, usd, rate: cop / php };
  }

  function renderFx() {
    const has = state.fx.transfers.length > 0;
    $('#fxEmpty').classList.toggle('hidden', has);
    $('.fx-data').classList.toggle('hidden', !has);
    if (!has) return;
    const co = state.ledgers.co;
    const m = monthFx(currentMonth), prev = monthFx(shiftMonth(currentMonth, -1));
    const spent = sumBy(txOfMonth(currentMonth, co), 'expense');
    const pending = sumPending(txOfMonth(currentMonth, co));
    const ref = state.fx.referenceRate;
    $('#fxSent').textContent = m ? fmtPh(m.php) : '–';
    $('#fxSentSub').textContent = m && m.usd ? 'vía ' + fmt(m.usd, 'USD') : m ? '' : 'Sin envíos';
    $('#fxReceived').textContent = m ? fmtCo(m.cop) : '–';
    $('#fxReceivedSub').textContent = m && m.usd ? fmtRate(m.cop / m.usd) + ' COP/US$' : '';
    $('#fxRate').textContent = m ? fmtRate(m.rate) : '–';
    const parts = [];
    if (m && prev) { const p = (m.rate / prev.rate - 1) * 100; parts.push('<span class="' + (p >= 0 ? 'good' : 'bad') + '">' + (p >= 0 ? '▲' : '▼') + Math.abs(p).toFixed(1) + '% vs. mes ant.</span>'); }
    if (m && ref) { const p = (m.rate / ref - 1) * 100; parts.push('<span class="' + (p >= 0 ? 'good' : 'bad') + '">' + (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '% vs. ref.</span>'); }
    $('#fxRateSub').innerHTML = parts.join('<br>');
    const received = m ? m.cop : 0;
    $('#fxBalance').textContent = received || spent ? fmtCo(received - spent) : '–';
    $('#fxBalance').classList.toggle('bad', received - spent < 0);
    $('#fxBalanceSub').textContent = 'Pagado ' + fmtShort(spent, co.currency) + (pending ? ' · pendiente ' + fmtShort(pending, co.currency) : '');
    renderFxChart();
    renderFxTable();
  }

  function renderFxChart() {
    if (typeof Chart === 'undefined') return;
    chartDefaults();
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonth(currentMonth, -i));
    const rates = months.map(k => { const m = monthFx(k); return m ? Math.round(m.rate * 100) / 100 : null; });
    const accent = cssVar('--accent');
    const ds = [{ label: 'COP por ₱', data: rates, borderColor: accent, backgroundColor: accent, borderWidth: 2, tension: 0.25, spanGaps: true, pointRadius: months.map(k => (k === currentMonth ? 5 : 3)) }];
    const ref = state.fx.referenceRate;
    if (ref) ds.push({ label: 'Referencia', data: months.map(() => ref), borderColor: cssVar('--muted'), borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 });
    charts.fx && charts.fx.destroy();
    charts.fx = new Chart($('#chartFx'), {
      type: 'line',
      data: { labels: months.map(k => monthLabel(k, true)), datasets: ds },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: !!ref, position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmtRate(c.parsed.y) } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: cssVar('--border') }, border: { display: false } } },
        onClick: (_, els) => { if (els.length) setMonth(months[els[0].index]); },
      },
    });
  }

  function renderFxTable() {
    const rows = fxRows();
    const tot = rows.reduce((a, r) => ({ php: a.php + r.php, cop: a.cop + r.cop, spent: a.spent + r.spent }), { php: 0, cop: 0, spent: 0 });
    $('#fxTable').innerHTML = '<thead><tr><th>Fecha</th><th class="num">Enviado ₱</th><th class="num">Recibido</th><th class="num">COP/₱</th><th class="num">Pagado</th><th class="num">Saldo</th></tr></thead><tbody>' +
      rows.map(r => '<tr data-id="' + r.id + '"' + (r.key === currentMonth ? ' class="selected"' : '') + '><td>' +
        new Date(r.date + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' }) + '</td><td class="num">' + fmtPh(r.php) + '</td><td class="num">' + fmtCo(r.cop) +
        '</td><td class="num">' + fmtRate(r.rate) + '</td><td class="num">' + fmtCo(r.spent) + '</td><td class="num ' + (r.balance < 0 ? 'bad' : 'good') + '">' + fmtCo(r.balance) + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + fmtPh(tot.php) + '</td><td class="num">' + fmtCo(tot.cop) + '</td><td class="num">' + (tot.php ? fmtRate(tot.cop / tot.php) : '') +
      '</td><td class="num">' + fmtCo(tot.spent) + '</td><td class="num">' + fmtCo(tot.cop - tot.spent) + '</td></tr></tfoot>';
  }

  $('#fxTable').addEventListener('click', e => { const tr = e.target.closest('tbody tr[data-id]'); if (tr) openFxDialog(state.fx.transfers.find(t => t.id === tr.dataset.id)); });
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
    $('#fxFormRate').textContent = parts.join(' · ');
  }
  $('#fxForm').addEventListener('input', updateFxFormRate);
  $('#fxDialog').addEventListener('close', () => {
    if ($('#fxDialog').returnValue !== 'save') return;
    const f = $('#fxForm');
    const t = { date: f.date.value, php: Math.round(parseFloat(f.php.value) * 100) / 100, usd: parseFloat(f.usd.value) > 0 ? Math.round(parseFloat(f.usd.value) * 100) / 100 : null, cop: Math.round(parseFloat(f.cop.value) * 100) / 100 };
    if (!t.date || !(t.php > 0) || !(t.cop > 0)) return;
    const list = state.fx.transfers;
    if (editingFx) {
      const i = list.findIndex(x => x.id === editingFx);
      if (i >= 0) list[i] = Object.assign({ id: editingFx, source: list[i].source }, t);
    } else {
      t.id = newId('m');
      list.push(t);
    }
    save();
    render();
    toast('Transferencia guardada');
  });
  $('#fxDelete').addEventListener('click', () => {
    if (!editingFx || !confirm('¿Eliminar esta transferencia?')) return;
    state.fx.transfers = state.fx.transfers.filter(t => t.id !== editingFx);
    save();
    $('#fxDialog').close('deleted');
    render();
  });

  // ---------- Presupuestos ----------
  function renderBudgetForm() {
    const lg = L();
    const cats = Array.from(new Set(lg.categories.concat(lg.transactions.filter(regular).map(t => t.category), Object.keys(lg.budgets)))).sort((a, b) => a.localeCompare(b, 'es'));
    const avg = {};
    for (const c of cats) {
      const vals = [1, 2, 3].map(i => txOfMonth(shiftMonth(currentMonth, -i)).filter(t => t.type === 'expense' && !t.pending && t.category === c).reduce((s, t) => s + t.amount, 0)).filter(v => v > 0);
      avg[c] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    $('#budgetForm').innerHTML = cats.length ? cats.map(c =>
      '<label class="budget-input"><span>' + escapeHtml(c) + (avg[c] ? '<small>promedio 3 meses: ' + fmt(avg[c]) + '</small>' : '') + '</span>' +
      '<input type="number" min="0" step="1" inputmode="decimal" data-cat="' + escapeHtml(c) + '" value="' + (lg.budgets[c] || '') + '" placeholder="Sin límite"></label>').join('')
      : '<p class="empty-note">Aún no hay categorías en ' + escapeHtml(lg.name) + '.</p>';
  }
  $('#budgetForm').addEventListener('change', e => {
    const input = e.target.closest('input[data-cat]');
    if (!input) return;
    const v = parseFloat(input.value);
    if (v > 0) L().budgets[input.dataset.cat] = v; else delete L().budgets[input.dataset.cat];
    save();
  });
  $('#addCategoryBtn').addEventListener('click', () => {
    const name = $('#newCategory').value.trim();
    if (!name) return;
    if (!L().categories.includes(name)) L().categories.push(name);
    $('#newCategory').value = '';
    save();
    renderBudgetForm();
  });

  // ---------- Importar ----------
  let workbook = null, matrix = [], rowOffset = 0, parsed = { transactions: [], skipped: 0 }, sheetsCache = [], quickParsed = null;

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('#fileInput').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });

  const sheetMatrix = ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });

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
      quickParsed = Parse.parseGastosPH(sheetsCache);
      $('#quickImport').classList.toggle('hidden', !quickParsed);
      $('#importStep2').classList.toggle('hidden', !!quickParsed);
      if (quickParsed) renderQuick(); else loadSheet(true);
    };
    reader.readAsArrayBuffer(file);
  }

  function renderQuick() {
    const q = quickParsed;
    const sumT = (txs, f) => txs.filter(f).reduce((s, t) => s + t.amount, 0);
    const coPaid = q.co.transactions.filter(t => t.type === 'expense' && !t.pending);
    const fin = q.savings.moves.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0);
    const fout = q.savings.moves.filter(m => m.type === 'out').reduce((s, m) => s + m.amount, 0);
    $('#quickSummary').innerHTML = [
      '🇵🇭 <b>Filipinas</b>: ' + q.ph.transactions.length + ' movimientos y ' + Object.keys(q.ph.budgets).length + ' presupuestos.',
      '🎁 <b>Prima en Filipinas</b>: ' + q.ph.extraTransactions.length + ' movimientos extraordinarios (bruto ' + fmtPh(sumT(q.ph.extraTransactions, t => t.type === 'income')) + ').',
      '🇨🇴 <b>Colombia</b>: ' + coPaid.length + ' pagos, saldo inicial ' + fmtCo(q.coSummary.opening) + ' y ' + q.coSummary.transactions.length + ' movimientos extraordinarios.',
      '🎁 <b>Fondo de primas</b>: recibido ' + fmtCo(fin) + ', usado ' + fmtCo(fout) + '; ' + q.savings.cdts.length + ' registros de CDT.',
      '⇄ <b>Cambio</b>: ' + q.fx.transfers.length + ' transferencias.',
    ].map(li => '<li>' + li + '</li>').join('');
  }

  $('#quickManual').addEventListener('click', () => {
    $('#quickImport').classList.add('hidden');
    $('#importStep2').classList.remove('hidden');
    loadSheet(true);
  });

  function syncInto(list, incoming, source) {
    return list.filter(t => t.source !== source).concat(incoming.map(t => Object.assign({}, t, { source })));
  }

  $('#quickImportBtn').addEventListener('click', () => {
    const q = quickParsed;
    if (!q) return;
    const ph = state.ledgers.ph, co = state.ledgers.co;
    ph.transactions = syncInto(ph.transactions, q.ph.transactions.concat(q.ph.extraTransactions), 'libro:' + q.ph.sheet);
    Object.assign(ph.budgets, q.ph.budgets);
    co.transactions = syncInto(co.transactions, q.co.transactions, 'libro:' + q.co.sheet);
    co.transactions = syncInto(co.transactions, q.coSummary.transactions, 'libro:resumen');
    co.opening = q.coSummary.opening;
    state.fx.transfers = syncInto(state.fx.transfers, q.fx.transfers, 'libro:cambio');
    if (q.fx.referenceRate && !state.fx.referenceRate) state.fx.referenceRate = q.fx.referenceRate;
    state.savings.moves = syncInto(state.savings.moves, q.savings.moves, 'libro:primas');
    state.savings.cdts = syncInto(state.savings.cdts, q.savings.cdts, 'libro:cdt');
    save();
    renderSettings();
    toast('Libro importado');
    setMonth(initialMonth());
    showView('inicio');
  });

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
    return Array.from({ length: width }, (_, i) => { const h = row[i]; return h instanceof Date ? h : h == null || h === '' ? null : h; });
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
  let extraChoices = {};
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
  const excelRow = idx => idx + 1 + rowOffset;
  const matrixIdx = row => row - 1 - rowOffset;
  function guessEndRow() {
    const body = matrix.slice(headerIndex() + 1);
    $('#wideEndRow').value = excelRow(headerIndex() + Parse.findTableEnd(body, currentMap().wideCategory, ['pagado']));
  }
  function toggleLayout() {
    const wide = $('#layoutSelect').value === 'wide';
    $('#mapRows').classList.toggle('hidden', wide);
    $('#mapWide').classList.toggle('hidden', !wide);
  }
  function currentMap() { const m = {}; $$('[data-map]').forEach(sel => { m[sel.dataset.map] = +sel.value; }); return m; }
  function renderExtras(extras, year) {
    const box = $('#wideExtras');
    if (!extras.length) { box.innerHTML = ''; return; }
    const months = Array.from({ length: 12 }, (_, i) => year + '-' + pad2(i + 1));
    box.innerHTML = '<p class="hint">Columnas que no son un mes:</p>' + extras.map(e => '<label>' + colLetter(e.index) + ': ' + escapeHtml(e.label) +
      '<select data-extra="' + e.index + '"><option value="">No importar</option>' + months.map(k => '<option value="' + k + '"' + (extraChoices[e.index] === k ? ' selected' : '') + '>' + escapeHtml(monthLabel(k)) + '</option>').join('') + '</select></label>').join('');
  }
  $('#wideExtras').addEventListener('change', e => {
    const sel = e.target.closest('[data-extra]');
    if (!sel) return;
    if (sel.value) extraChoices[sel.dataset.extra] = sel.value; else delete extraChoices[sel.dataset.extra];
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
      const monthCols = parsed.monthColumns.filter(c => !c.label);
      $('#wideMonthsHint').textContent = (monthCols.length ? 'Meses: ' + monthCols.map(c => colLetter(c.index)).join(', ') + '.' : 'No se detectaron columnas de mes.') + ' ' + parsed.categories + ' categorías.';
    } else {
      const body = matrix.slice(headerIndex() + 1);
      const hasNegatives = map.amount >= 0 && body.some(r => r && Parse.parseAmount(r[map.amount]) < 0);
      parsed = Parse.rowsToTransactions(body, map, { negativeMeans: $('#negativeMeans').value, hasNegatives });
    }
    const cur = importCurrency();
    $('#previewTable').innerHTML = '<thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th class="num">Monto</th></tr></thead><tbody>' +
      parsed.transactions.slice(0, 8).map(t => '<tr><td>' + t.date + '</td><td>' + (t.type === 'income' ? 'Ingreso' : t.pending ? 'Pendiente' : 'Gasto') + '</td><td>' + escapeHtml(t.category) + '</td><td class="num">' + fmt(t.amount, cur) + '</td></tr>').join('') + '</tbody>';
    const n = parsed.transactions.length;
    $('#previewSummary').textContent = n ? n + ' movimientos listos.' : 'No se encontraron movimientos. Revisa la fila de encabezados y las columnas.';
    $('#doImport').disabled = !n;
  }
  $('#sheetSelect').addEventListener('change', () => loadSheet(true));
  $('#importLedger').addEventListener('change', updatePreview);
  $('#headerRow').addEventListener('change', () => { fillMapSelects(); guessLayoutAndMapping(); updatePreview(); });
  $('#layoutSelect').addEventListener('change', () => { toggleLayout(); updatePreview(); });
  $$('[data-map]').forEach(s => s.addEventListener('change', () => { if (s.dataset.map === 'wideCategory') guessEndRow(); updatePreview(); }));
  $('#negativeMeans').addEventListener('change', updatePreview);
  $('#wideYear').addEventListener('change', () => { extraChoices = {}; updatePreview(); });
  $('#wideEndRow').addEventListener('change', updatePreview);
  $('#doImport').addEventListener('click', () => {
    const k = $('#importLedger').value, lg = state.ledgers[k];
    const source = $('#layoutSelect').value + ':' + $('#sheetSelect').value;
    const incoming = parsed.transactions.map(t => Object.assign({}, t, { source }));
    if (!incoming.length) return;
    const mode = $('#importMode').value;
    if (mode === 'replace') {
      if (lg.transactions.length && !confirm('Se reemplazarán ' + lg.transactions.length + ' movimientos de ' + lg.name + '. ¿Continuar?')) return;
      lg.transactions = incoming;
    } else if (mode === 'sync') {
      lg.transactions = syncInto(lg.transactions, incoming, source);
    } else {
      const ids = new Set(lg.transactions.map(t => t.id));
      lg.transactions = lg.transactions.concat(incoming.filter(t => !ids.has(t.id)));
    }
    Object.assign(lg.budgets, parsedBudgets);
    save();
    toast(incoming.length + ' movimientos importados en ' + lg.name);
    setLedger(k);
    setMonth(latestMonth(incoming) || currentMonth);
    showView('gastos');
  });

  // ---------- Más: ajustes, exportar, copia ----------
  function renderSettings() {
    $$('[data-currency]').forEach(sel => {
      sel.innerHTML = CURRENCIES.map(([code, name]) => '<option value="' + code + '">' + escapeHtml(name) + '</option>').join('');
      sel.value = state.ledgers[sel.dataset.currency].currency;
    });
    $$('[data-opening]').forEach(inp => { inp.value = state.ledgers[inp.dataset.opening].opening || ''; });
    $('#fxReference').value = state.fx.referenceRate || '';
  }
  $$('[data-currency]').forEach(sel => sel.addEventListener('change', () => { state.ledgers[sel.dataset.currency].currency = sel.value; save(); }));
  $$('[data-opening]').forEach(inp => inp.addEventListener('change', () => { state.ledgers[inp.dataset.opening].opening = parseFloat(inp.value) || 0; save(); }));
  $('#fxReference').addEventListener('change', e => { const v = parseFloat(e.target.value); state.fx.referenceRate = v > 0 ? v : null; save(); });

  async function saveFile(name, blob) {
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  function markBackup() { state.lastBackup = new Date().toISOString(); save(); renderBackupInfo(); }
  function renderBackupInfo() {
    const last = state.lastBackup ? new Date(state.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    $('#lastBackupText').textContent = last ? 'Última copia: ' + last.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Aún no has hecho ninguna copia.';
    const hasData = state.ledgers.ph.transactions.length + state.ledgers.co.transactions.length > 0;
    $('#backupBanner').classList.toggle('hidden', !(hasData && (days === null || days >= 14)));
    $('#backupBannerText').textContent = days === null ? 'Tus datos solo están en este dispositivo.' : 'Hace ' + days + ' días de tu última copia.';
  }
  function exportBackup() {
    saveFile('mis-gastos-copia-' + todayISO() + '.json', new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }))
      .then(ok => { if (ok) { markBackup(); toast('Copia de seguridad lista'); } });
  }
  $('#exportJson').addEventListener('click', exportBackup);
  $('#backupNow').addEventListener('click', exportBackup);
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
      setMonth(initialMonth());
      toast('Copia restaurada');
    }).catch(err => toast('No se pudo restaurar: ' + err.message));
  });

  function monthlySummarySheet(lg) {
    const paid = lg.transactions.filter(t => !t.pending && regular(t));
    const months = Array.from(new Set(paid.map(t => t.date.slice(0, 7)))).sort();
    const r2 = v => Math.round(v * 100) / 100;
    const sum = (type, cat, k) => paid.reduce((s, t) => s + (t.type === type && (cat === null || t.category === cat) && t.date.startsWith(k) ? t.amount : 0), 0);
    const cats = type => Array.from(new Set(paid.filter(t => t.type === type).map(t => t.category))).sort((a, b) => a.localeCompare(b, 'es'));
    const row = (label, budget, vals) => [label, budget].concat(vals, [r2(vals.reduce((a, b) => a + b, 0))]);
    const aoa = [['Categoría', 'Presupuesto'].concat(months.map(k => monthLabel(k, true)), ['Total'])];
    const ic = cats('income');
    if (ic.length) {
      aoa.push(['INGRESOS']);
      ic.forEach(c => aoa.push(row(c, null, months.map(k => r2(sum('income', c, k))))));
      aoa.push(row('TOTAL INGRESOS', null, months.map(k => r2(sum('income', null, k)))), []);
    }
    aoa.push(['GASTOS']);
    cats('expense').forEach(c => aoa.push(row(c, lg.budgets[c] || null, months.map(k => r2(sum('expense', c, k))))));
    aoa.push(row('TOTAL GASTOS', budgetTotal(lg) || null, months.map(k => r2(sum('expense', null, k)))));
    if (ic.length) aoa.push(row('RESULTADO', null, months.map(k => r2(sum('income', null, k) - sum('expense', null, k)))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 30 }, { wch: 12 }].concat(months.map(() => ({ wch: 12 })), [{ wch: 13 }]);
    return ws;
  }
  $('#exportXlsx').addEventListener('click', () => {
    const wb = XLSX.utils.book_new();
    const b = balances(), sv = savingsTotals();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Saldos al ' + todayISO()],
      ['Saldo Colombia (total)', r(b.coAvail + sv.fund)], ['  Disponible', r(b.coAvail)], ['  Fondo de primas', r(sv.fund)],
      ['Inversiones CDT ' + (sv.cdtYear || ''), r(sv.cdt)], ['Ahorro total (primas + CDT)', r(sv.fund + sv.cdt)],
      ['Filipinas, resultado ' + b.year, r(b.phRes)], ['Filipinas, ahorro mensual ' + b.year, r(b.phSaving)],
    ]), 'Saldos');
    function r(v) { return Math.round(v * 100) / 100; }
    for (const key of ['ph', 'co']) {
      const lg = state.ledgers[key];
      if (!lg.transactions.length) continue;
      XLSX.utils.book_append_sheet(wb, monthlySummarySheet(lg), 'Resumen ' + lg.name);
      const rows = lg.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => ({
        Fecha: t.date, Tipo: t.type === 'income' ? 'Ingreso' : 'Gasto', Estado: t.pending ? 'Pendiente' : 'Pagado', Extraordinario: t.extra ? 'Sí' : '',
        Categoría: t.category, Descripción: t.description, ['Monto ' + lg.currency]: t.amount,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Movimientos ' + lg.name);
    }
    if (state.savings.moves.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.savings.moves.slice().sort((a, b) => a.date.localeCompare(b.date)).map(m => ({
        Fecha: m.date, Tipo: m.type === 'in' ? 'Aporte' : m.invest ? 'Inversión' : 'Uso', Concepto: m.concept, 'Monto COP': m.type === 'in' ? m.amount : -m.amount,
      }))), 'Fondo de primas');
    }
    if (state.savings.cdts.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.savings.cdts.map(c => ({ Año: c.year, Nombre: c.name, 'Monto COP': c.amount }))), 'CDT');
    const fx = fxRows().map(x => ({ Fecha: x.date, 'Enviado PHP': x.php, 'US$': x.usd, 'Recibido COP': x.cop, 'COP por PHP': Math.round(x.rate * 10000) / 10000, 'Pagado COP': x.spent, 'Saldo COP': x.balance }));
    if (fx.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fx), 'Cambio');
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveFile('mis-gastos-' + todayISO() + '.xlsx', new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      .then(ok => { if (ok) { markBackup(); toast('Excel exportado'); } });
  });

  $('#clearAll').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los datos de este dispositivo (en esta versión)?')) return;
    state = defaultState();
    save();
    renderSettings();
    setLedger('ph');
    toast('Datos borrados');
  });

  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  renderSettings();
  setLedger(state.active);
  setMonth(currentMonth);
  showView('inicio');
})();
