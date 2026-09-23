(function () {
  'use strict';

  const STORAGE_KEY = 'misGastos.v1';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // ---------- Estado ----------
  const defaultState = () => ({ transactions: [], budgets: {}, categories: [], settings: { currency: 'PHP' } });

  let state = load();
  let currentMonth = latestMonth() || monthKey(new Date());
  const charts = {};

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
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

  // ---------- Utilidades ----------
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }

  // Último mes con gastos (los ingresos futuros ya planeados no cuentan).
  function latestMonth(txs) {
    txs = txs || state.transactions;
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
  function fmt(n) {
    const decimals = Math.abs(n) >= 1000 ? 0 : 2;
    try {
      return new Intl.NumberFormat('es', { style: 'currency', currency: state.settings.currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
    } catch (e) {
      return n.toFixed(2);
    }
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
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function allCategories() {
    const set = new Set(state.categories);
    for (const t of state.transactions) set.add(t.category);
    for (const c of Object.keys(state.budgets)) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  function txOfMonth(key) { return state.transactions.filter(t => t.date.startsWith(key)); }

  function sumBy(txs, type) { return txs.reduce((s, t) => s + (t.type === type ? t.amount : 0), 0); }

  // ---------- Navegación ----------
  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $('.month-picker').style.visibility = name === 'resumen' || name === 'movimientos' ? 'visible' : 'hidden';
    if (name === 'presupuestos') renderBudgetForm();
    window.scrollTo(0, 0);
  }

  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => showView(b.dataset.goto)));

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
  }

  function renderDashboard() {
    const empty = !state.transactions.length;
    $('#emptyState').classList.toggle('hidden', !empty);
    $$('.needs-data').forEach(el => el.classList.toggle('hidden', empty));

    const txs = txOfMonth(currentMonth);
    const spent = sumBy(txs, 'expense');
    const income = sumBy(txs, 'income');
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

    const totalBudget = Object.values(state.budgets).reduce((s, v) => s + (v || 0), 0);
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

    $('#kpiIncome').textContent = income ? fmt(income) : '–';
    $('#kpiBalance').textContent = income ? 'Balance: ' + fmt(income - spent) : '';

    const last6 = [];
    for (let i = 1; i <= 6; i++) {
      const k = shiftMonth(currentMonth, -i);
      const s = sumBy(txOfMonth(k), 'expense');
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

  function renderCharts(txs) {
    if (typeof Chart === 'undefined') return;
    const text = cssVar('--text-muted');
    const grid = cssVar('--border');
    Chart.defaults.color = text;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

    const byCat = {};
    for (const t of txs) if (t.type === 'expense') byCat[t.category] = (byCat[t.category] || 0) + t.amount;
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
    const incomeSeries = months.map(k => sumBy(txOfMonth(k), 'income'));
    const hasIncome = incomeSeries.some(v => v > 0);
    const accent = cssVar('--accent');

    const datasets = [{
      label: 'Gastos', data: spentSeries, borderRadius: 4,
      backgroundColor: months.map(k => (k === currentMonth ? accent : accent + '66')),
    }];
    if (hasIncome) datasets.push({ type: 'line', label: 'Ingresos', data: incomeSeries, borderColor: cssVar('--good'), backgroundColor: cssVar('--good'), tension: 0.3, pointRadius: 2 });

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
          y: { grid: { color: grid }, ticks: { callback: v => fmt(v).replace(/[.,]00(?=\D*$)/, '') } },
        },
        onClick: (_, els) => { if (els.length) setMonth(months[els[0].index]); },
      },
    });
  }

  function renderBudgetTable(txs) {
    const byCat = {};
    for (const t of txs) if (t.type === 'expense') byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    const cats = Array.from(new Set(Object.keys(byCat).concat(Object.keys(state.budgets).filter(c => state.budgets[c] > 0))));
    cats.sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));

    if (!cats.length) {
      $('#budgetTable').innerHTML = '<p class="hint">Sin gastos en ' + escapeHtml(monthLabel(currentMonth)) + '.</p>';
      return;
    }
    $('#budgetTable').innerHTML = cats.map(c => {
      const spent = byCat[c] || 0;
      const budget = state.budgets[c] || 0;
      const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
      const status = !budget ? '' : spent > budget * 1.005 ? 'over' : spent > budget * 0.85 ? 'warn' : 'ok';
      return '<div class="budget-row ' + status + '">' +
        '<div class="budget-head"><span class="budget-name">' + escapeHtml(c) + '</span>' +
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
      .sort((a, b) => b.date.localeCompare(a.date));

    if (!txs.length) {
      $('#txList').innerHTML = '<p class="hint">No hay movimientos para este filtro.</p>';
      return;
    }
    $('#txList').innerHTML = txs.map(t => {
      const d = new Date(t.date + 'T00:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' });
      return '<button class="tx" data-id="' + t.id + '">' +
        '<span class="tx-date">' + d + '</span>' +
        '<span class="tx-main"><span class="tx-desc">' + escapeHtml(t.description || t.category) + '</span>' +
        '<span class="tx-cat">' + escapeHtml(t.category) + '</span></span>' +
        '<span class="tx-amt ' + t.type + '">' + (t.type === 'income' ? '+' : '−') + fmt(t.amount) + '</span></button>';
    }).join('');
  }

  $('#txSearch').addEventListener('input', renderTxList);
  $('#txCategoryFilter').addEventListener('change', renderTxList);
  $('#txList').addEventListener('click', e => {
    const b = e.target.closest('.tx');
    if (b) openTxDialog(state.transactions.find(t => t.id === b.dataset.id));
  });
  $('#addTxBtn').addEventListener('click', () => openTxDialog(null));

  let editingId = null;
  function openTxDialog(tx) {
    const f = $('#txForm');
    editingId = tx ? tx.id : null;
    $('#txDialogTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
    const today = new Date();
    const defDate = currentMonth === monthKey(today) ? Parse.toISODate(today) : currentMonth + '-01';
    f.type.value = tx ? tx.type : 'expense';
    f.date.value = tx ? tx.date : defDate;
    f.amount.value = tx ? tx.amount : '';
    f.category.value = tx ? tx.category : '';
    f.description.value = tx ? tx.description : '';
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
    if (!tx.date || !(tx.amount > 0)) return;
    if (editingId) {
      const i = state.transactions.findIndex(t => t.id === editingId);
      if (i >= 0) state.transactions[i] = Object.assign({ id: editingId }, tx);
    } else {
      tx.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      state.transactions.push(tx);
    }
    save();
    render();
    toast('Movimiento guardado');
  });

  $('#txDelete').addEventListener('click', () => {
    if (!editingId || !confirm('¿Eliminar este movimiento?')) return;
    state.transactions = state.transactions.filter(t => t.id !== editingId);
    save();
    $('#txDialog').close('deleted');
    render();
    toast('Movimiento eliminado');
  });

  // ---------- Importar Excel ----------
  let workbook = null;
  let matrix = [];
  let rowOffset = 0; // fila de Excel donde empieza el rango de la hoja
  let parsed = { transactions: [], skipped: 0 };

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
      $('#sheetSelect').innerHTML = workbook.SheetNames.map(n => '<option>' + escapeHtml(n) + '</option>').join('');
      $('#importStep2').classList.remove('hidden');
      loadSheet(true);
      $('#importStep2').scrollIntoView({ behavior: 'smooth' });
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSheet(autoDetect) {
    const ws = workbook.Sheets[$('#sheetSelect').value];
    matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
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
    const monthHeaders = hs.filter(h => Parse.parseMonthHeader(h)).length;
    const guess = Parse.guessMapping(hs.map(h => (h instanceof Date ? '' : h)));
    const wide = monthHeaders >= 3 && guess.date < 0;
    $('#layoutSelect').value = wide ? 'wide' : 'rows';
    const wideCat = Parse.guessCategoryColumn(matrix, headerIndex());
    const wideBudget = Parse.findBudgetColumn(matrix, headerIndex(), wideCat);
    fillMapSelects(Object.assign({}, guess, { wideCategory: wideCat, wideBudget }));
    const yearFromHeader = hs.map(Parse.parseMonthHeader).find(m => m && m.year);
    const sheetYear = /^(19|20)\d{2}$/.test($('#sheetSelect').value.trim()) ? +$('#sheetSelect').value.trim() : null;
    $('#wideYear').value = yearFromHeader ? yearFromHeader.year : sheetYear || new Date().getFullYear();
    extraChoices = {};
    guessEndRow();
    toggleLayout();
  }

  // Excel row number <-> índice en `matrix`.
  function excelRow(idx) { return idx + 1 + rowOffset; }
  function matrixIdx(row) { return row - 1 - rowOffset; }

  function guessEndRow() {
    const body = matrix.slice(headerIndex() + 1);
    const end = Parse.findTableEnd(body, currentMap().wideCategory);
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

  function updatePreview() {
    const map = currentMap();
    parsedBudgets = {};

    if ($('#layoutSelect').value === 'wide') {
      const endIdx = Math.max(headerIndex(), matrixIdx(+$('#wideEndRow').value || excelRow(matrix.length - 1)));
      const body = matrix.slice(headerIndex() + 1, endIdx + 1);
      const year = +$('#wideYear').value;
      renderExtras(Parse.findExtraColumns(headers(), body, map.wideCategory, map.wideBudget), year);
      parsed = Parse.wideToTransactions(headers(), body, map.wideCategory, year, { extraColumns: extraChoices });
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

    const sample = parsed.transactions.slice(0, 8);
    $('#previewTable').innerHTML = '<thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th class="num">Monto</th></tr></thead><tbody>' +
      sample.map(t => '<tr><td>' + t.date + '</td><td>' + (t.type === 'income' ? 'Ingreso' : 'Gasto') + '</td><td>' + escapeHtml(t.category) +
        '</td><td>' + escapeHtml(t.description) + '</td><td class="num">' + fmt(t.amount) + '</td></tr>').join('') + '</tbody>';

    const n = parsed.transactions.length;
    const total = parsed.transactions.reduce((s, t) => s + (t.type === 'expense' ? t.amount : 0), 0);
    $('#previewSummary').textContent = n
      ? n + ' movimientos listos (gastos por ' + fmt(total) + ').' + (parsed.skipped ? ' Se omitieron ' + parsed.skipped + ' filas sin fecha o monto válido.' : '')
      : 'No se encontraron movimientos. Revisa la fila de encabezados y las columnas elegidas.';
    $('#doImport').disabled = !n;
  }

  $('#sheetSelect').addEventListener('change', () => loadSheet(true));
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
    // `source` identifica la hoja de origen, para poder actualizarla al re-importar.
    const source = $('#layoutSelect').value + ':' + $('#sheetSelect').value;
    const incoming = parsed.transactions.map(t => Object.assign({}, t, { source }));
    if (!incoming.length) return;
    const mode = $('#importMode').value;
    let msg;
    if (mode === 'replace') {
      if (state.transactions.length && !confirm('Se reemplazarán ' + state.transactions.length + ' movimientos existentes. ¿Continuar?')) return;
      state.transactions = incoming;
      msg = incoming.length + ' movimientos importados';
    } else if (mode === 'sync') {
      // El Excel manda: lo que vino antes de esta hoja se cambia por lo actual.
      // Los movimientos agregados a mano (sin `source`) se conservan.
      const before = state.transactions.filter(t => t.source === source).length;
      state.transactions = state.transactions.filter(t => t.source !== source).concat(incoming);
      msg = before ? 'Hoja actualizada: ' + incoming.length + ' movimientos (antes ' + before + ')' : incoming.length + ' movimientos importados';
    } else {
      const ids = new Set(state.transactions.map(t => t.id));
      const fresh = incoming.filter(t => !ids.has(t.id));
      state.transactions = state.transactions.concat(fresh);
      msg = fresh.length + ' movimientos importados' + (fresh.length < incoming.length ? ' (' + (incoming.length - fresh.length) + ' ya existían)' : '');
    }
    const nb = Object.keys(parsedBudgets).length;
    if (nb) {
      Object.assign(state.budgets, parsedBudgets);
      msg += ' y ' + nb + ' presupuestos';
    }
    save();
    toast(msg);
    setMonth(latestMonth(incoming) || currentMonth);
    showView('resumen');
  });

  // ---------- Presupuestos ----------
  function renderBudgetForm() {
    const cats = allCategories();
    // Sugerencia: promedio de los últimos 3 meses con gasto en la categoría.
    const avg = {};
    for (const c of cats) {
      const vals = [1, 2, 3].map(i => txOfMonth(shiftMonth(currentMonth, -i)).filter(t => t.type === 'expense' && t.category === c).reduce((s, t) => s + t.amount, 0)).filter(v => v > 0);
      avg[c] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    $('#budgetForm').innerHTML = cats.length ? cats.map(c =>
      '<label class="budget-input"><span>' + escapeHtml(c) + (avg[c] ? '<small>prom. 3 meses: ' + fmt(avg[c]) + '</small>' : '') + '</span>' +
      '<input type="number" min="0" step="1" inputmode="decimal" data-cat="' + escapeHtml(c) + '" value="' + (state.budgets[c] || '') + '" placeholder="Sin límite"></label>'
    ).join('') : '<p class="hint">Aún no hay categorías. Importa tu Excel o agrega una.</p>';
  }

  $('#budgetForm').addEventListener('change', e => {
    const input = e.target.closest('input[data-cat]');
    if (!input) return;
    const v = parseFloat(input.value);
    if (v > 0) state.budgets[input.dataset.cat] = v;
    else delete state.budgets[input.dataset.cat];
    save();
    renderDashboard();
  });

  $('#addCategoryBtn').addEventListener('click', () => {
    const name = $('#newCategory').value.trim();
    if (!name) return;
    if (!state.categories.includes(name)) state.categories.push(name);
    $('#newCategory').value = '';
    save();
    renderBudgetForm();
    renderCategoryOptions();
  });

  // ---------- Ajustes ----------
  $('#currencySelect').value = state.settings.currency;
  $('#currencySelect').addEventListener('change', e => { state.settings.currency = e.target.value; save(); render(); });

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
      if (!Array.isArray(data.transactions)) throw new Error('formato no válido');
      if (!confirm('Se reemplazarán los datos actuales por la copia (' + data.transactions.length + ' movimientos). ¿Continuar?')) return;
      state = Object.assign(defaultState(), data);
      save();
      $('#currencySelect').value = state.settings.currency;
      setMonth(latestMonth() || currentMonth);
      toast('Copia restaurada');
    }).catch(err => toast('No se pudo restaurar: ' + err.message));
  });

  $('#exportXlsx').addEventListener('click', () => {
    const rows = state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => ({
      Fecha: t.date, Tipo: t.type === 'income' ? 'Ingreso' : 'Gasto', Categoría: t.category, Descripción: t.description, Monto: t.amount,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Movimientos');
    const budgets = Object.entries(state.budgets).map(([c, v]) => ({ Categoría: c, 'Presupuesto mensual': v }));
    if (budgets.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(budgets), 'Presupuestos');
    XLSX.writeFile(wb, 'mis-gastos-' + Parse.toISODate(new Date()) + '.xlsx');
  });

  $('#clearAll').addEventListener('click', () => {
    if (!confirm('¿Borrar todos los movimientos y presupuestos de este dispositivo?')) return;
    state = defaultState();
    save();
    $('#currencySelect').value = state.settings.currency;
    render();
    toast('Datos borrados');
  });

  // Redibujar los gráficos si cambia el tema claro/oscuro.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderDashboard());
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  setMonth(currentMonth);
})();
