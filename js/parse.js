/* Funciones puras para interpretar los datos del Excel.
   Se exponen en window.Parse (navegador) y module.exports (tests con Node). */
(function (root) {
  'use strict';

  const MONTHS = {
    ene: 0, enero: 0, jan: 0, january: 0,
    feb: 1, febrero: 1, february: 1,
    mar: 2, marzo: 2, march: 2,
    abr: 3, abril: 3, apr: 3, april: 3,
    may: 4, mayo: 4,
    jun: 5, junio: 5, june: 5,
    jul: 6, julio: 6, july: 6,
    ago: 7, agosto: 7, aug: 7, august: 7,
    sep: 8, sept: 8, septiembre: 8, setiembre: 8, september: 8,
    oct: 9, octubre: 9, october: 9,
    nov: 10, noviembre: 10, november: 10,
    dic: 11, diciembre: 11, dec: 11, december: 11,
  };

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function toISODate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* Convierte "1.234,56", "$1,234.56", "(45)", "-12" o números en Number. */
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[^\d.,\-]/g, '');
    if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
    s = s.replace(/-/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      // El separador que aparece último es el decimal.
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      // Solo comas: decimal si hay 1-2 dígitos detrás de una única coma.
      const parts = s.split(',');
      s = parts.length === 2 && parts[1].length <= 2 ? parts[0] + '.' + parts[1] : parts.join('');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      // "1.234.567" o "1.234" (miles al estilo europeo) -> sin puntos
      if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return negative ? -n : n;
  }

  /* Excel serial (días desde 1899-12-30) -> Date local. */
  function excelSerialToDate(serial) {
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const utc = new Date(ms);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }

  /* Devuelve 'YYYY-MM-DD' o null. Acepta Date, serial de Excel,
     "dd/mm/yyyy", "yyyy-mm-dd", "12 ene 2026", etc. dayFirst por defecto. */
  function parseDate(v, dayFirst) {
    if (dayFirst === undefined) dayFirst = true;
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : toISODate(v);
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return toISODate(excelSerialToDate(v));
      return null;
    }
    const s = normalize(v);
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return build(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      let day = dayFirst ? a : b, month = dayFirst ? b : a;
      if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
      return build(y, month - 1, day);
    }
    m = s.match(/^(\d{1,2})(?:\s+de)?[\s\-/.]+([a-z]+)\.?(?:\s+de)?[\s\-/.]+(\d{2,4})/);
    if (m && MONTHS[m[2]] !== undefined) {
      let y = +m[3]; if (y < 100) y += 2000;
      return build(y, MONTHS[m[2]], +m[1]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return parseDate(parseFloat(s), dayFirst);
    return null;
  }

  function build(y, mo, d) {
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return toISODate(dt);
  }

  /* Interpreta un encabezado de columna como mes. Devuelve {year|null, month} o null.
     Acepta "Enero", "Sept. 2025", "dic-25", "03/2026" y marcas de quincena
     como "ENE 1A Q", "SEP 1q" u "OCT 1 Q". Los números sueltos no son meses. */
  function parseMonthHeader(v) {
    if (v instanceof Date) return isNaN(v) ? null : { year: v.getFullYear(), month: v.getMonth() };
    if (typeof v !== 'string') return null;
    const s = normalize(v).replace(/\./g, '');
    if (!s) return null;
    let m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[2], month: +m[1] - 1 };
    m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2] - 1 };

    const tokens = s.split(/[\s\-/']+/).filter(Boolean);
    if (!tokens.length || MONTHS[tokens[0]] === undefined) return null;
    let year = null;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (/^\d{4}$/.test(t)) year = +t;
      else if (i === 1 && /^\d{2}$/.test(t) && tokens.length === 2) year = 2000 + +t;
      else if (t === 'de' || t === 'del' || t === 'quincena') continue;
      else if (!/^\d{0,2}[a-z]{0,2}$/.test(t)) return null; // "1a", "q", "1q", "2da"…
    }
    return { year, month: MONTHS[tokens[0]] };
  }

  const GUESS = {
    date: ['fecha', 'date', 'dia', 'day', 'f. operacion', 'fecha operacion', 'fecha valor'],
    amount: ['monto', 'importe', 'valor', 'cantidad', 'amount', 'total', 'gasto', 'cargo', 'precio', 'costo', 'coste'],
    category: ['categoria', 'category', 'rubro', 'tipo de gasto', 'clasificacion', 'grupo', 'partida', 'concepto general'],
    description: ['descripcion', 'concepto', 'detalle', 'description', 'nota', 'notas', 'comercio', 'establecimiento', 'observaciones'],
    type: ['tipo', 'type', 'movimiento', 'ingreso/gasto', 'naturaleza'],
  };

  /* Sugiere qué columna corresponde a cada campo según el texto del encabezado. */
  function guessMapping(headers) {
    const norm = headers.map(normalize);
    const used = new Set();
    const result = {};
    for (const field of ['date', 'amount', 'category', 'description', 'type']) {
      let best = -1, bestScore = 0;
      norm.forEach((h, i) => {
        if (used.has(i) || !h) return;
        GUESS[field].forEach((kw, rank) => {
          const score = h === kw ? 100 - rank : h.includes(kw) ? 50 - rank : 0;
          if (score > bestScore) { bestScore = score; best = i; }
        });
      });
      result[field] = best;
      if (best >= 0) used.add(best);
    }
    return result;
  }

  /* Busca la primera fila que parece un encabezado (>=2 celdas de texto). */
  function guessHeaderRow(matrix) {
    // Una fila con 3 o más meses es casi seguro el encabezado de una tabla mensual.
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      if ((matrix[i] || []).filter(c => parseMonthHeader(c)).length >= 3) return i;
    }
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const row = matrix[i] || [];
      const texts = row.filter(c => typeof c === 'string' && c.trim() && isNaN(parseAmount(c)));
      if (texts.length >= 2) return i;
    }
    return 0;
  }

  const INCOME_WORDS = ['ingreso', 'income', 'abono', 'entrada', 'credito', 'haber', 'deposito', 'sueldo', 'nomina'];

  function isIncomeLabel(v) {
    const s = normalize(v);
    return !!s && INCOME_WORDS.some(w => s.includes(w));
  }

  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* Id estable: la misma fila importada dos veces no se duplica.
     `occurrence` distingue filas idénticas dentro del mismo archivo. */
  function txId(tx, occurrence) {
    return 'x' + hashString([tx.date, tx.type, tx.amount.toFixed(2), normalize(tx.category), normalize(tx.description), occurrence || 0].join('|'));
  }

  function withIds(txs) {
    const seen = {};
    return txs.map(tx => {
      const base = txId(tx, 0);
      const n = seen[base] = (seen[base] || 0) + 1;
      return Object.assign({}, tx, { id: n === 1 ? base : txId(tx, n - 1) });
    });
  }

  /* Formato "filas": cada fila es un movimiento. */
  function rowsToTransactions(rows, map, opts) {
    opts = opts || {};
    const out = [];
    let skipped = 0;
    for (const row of rows) {
      if (!row || row.every(c => c == null || c === '')) continue;
      const date = parseDate(row[map.date]);
      const raw = parseAmount(row[map.amount]);
      if (!date || isNaN(raw) || raw === 0) { skipped++; continue; }
      let type;
      if (map.type >= 0 && row[map.type] != null && row[map.type] !== '') {
        type = isIncomeLabel(row[map.type]) ? 'income' : 'expense';
      } else if (raw < 0) {
        type = opts.negativeMeans === 'income' ? 'income' : 'expense';
      } else {
        type = opts.negativeMeans === 'income' ? 'expense' : (opts.hasNegatives ? 'income' : 'expense');
      }
      const category = map.category >= 0 && row[map.category] != null && String(row[map.category]).trim()
        ? String(row[map.category]).trim() : 'Sin categoría';
      const description = map.description >= 0 && row[map.description] != null ? String(row[map.description]).trim() : '';
      out.push({ date, amount: Math.round(Math.abs(raw) * 100) / 100, type, category, description });
    }
    return { transactions: withIds(out), skipped };
  }

  // Texto con al menos dos letras ("Viene 2025" sí es etiqueta; "1.234,50" no).
  function isLabel(v) {
    return typeof v === 'string' && (v.match(/[a-z\u00c0-\u024f]/gi) || []).length >= 2;
  }

  const END_WORDS = ['resultado', 'balance', 'diferencia'];

  /* Columna con más etiquetas de texto debajo del encabezado: la de categorías. */
  function guessCategoryColumn(matrix, headerIdx) {
    const counts = [];
    matrix.slice(headerIdx + 1, headerIdx + 60).forEach(row => {
      (row || []).forEach((c, i) => { if (isLabel(c) && !parseMonthHeader(c)) counts[i] = (counts[i] || 0) + 1; });
    });
    let best = 0;
    counts.forEach((n, i) => { if (n > (counts[best] || 0)) best = i; });
    return best;
  }

  /* Número de filas de datos a leer: se detiene antes de "RESULTADO"/"Balance",
     que suele cerrar la tabla (lo de abajo son cálculos auxiliares). */
  function findTableEnd(rows, categoryCol) {
    for (let i = 0; i < rows.length; i++) {
      const label = normalize((rows[i] || [])[categoryCol]);
      if (END_WORDS.some(w => label.startsWith(w))) return i;
    }
    return rows.length;
  }

  /* Columna con el presupuesto/estimado mensual (se busca en el encabezado y la fila siguiente). */
  function findBudgetColumn(matrix, headerIdx, categoryCol) {
    for (const r of [headerIdx, headerIdx + 1]) {
      const row = matrix[r] || [];
      for (let i = 0; i < row.length; i++) {
        if (i === categoryCol) continue;
        if (/^(estimado|presupuesto|presup|budget|meta)\b/.test(normalize(row[i]))) return i;
      }
    }
    return -1;
  }

  /* Columnas con números que no son meses ni totales (p. ej. "Premiums and bonus"). */
  function findExtraColumns(headers, rows, categoryCol, budgetCol) {
    const out = [];
    headers.forEach((h, i) => {
      if (i === categoryCol || i === budgetCol || !isLabel(h) || parseMonthHeader(h)) return;
      if (/^(total|%|estimado|presupuesto|real)/.test(normalize(h))) return;
      if (rows.some(r => r && typeof r[i] === 'number' && r[i] !== 0)) out.push({ index: i, label: String(h).trim() });
    });
    return out;
  }

  /* Recorre las filas de categorías de una tabla mensual llevando la cuenta de
     la sección (INGRESOS / GASTOS). Llama a fn(row, category, section). */
  function eachCategoryRow(rows, categoryCol, fn) {
    let section = null;
    for (const row of rows) {
      if (!row || row.every(c => c == null || c === '')) continue;
      const raw = row[categoryCol];
      if (!isLabel(raw)) continue;
      const cat = String(raw).trim();
      const n = normalize(cat);
      if (n === 'ingresos' || n === 'ingreso') { section = 'income'; continue; }
      if (n === 'gastos' || n === 'egresos' || n === 'gasto') { section = 'expense'; continue; }
      if (/^(total|subtotal)/.test(n)) continue;
      fn(row, cat, section);
    }
  }

  /* Formato "tabla mensual": categorías en filas, un mes por columna.
     Cada celda se convierte en un movimiento el día 1 de ese mes.
     opts.extraColumns: { índiceColumna: 'YYYY-MM' } para columnas no-mes que se quieran incluir. */
  function wideToTransactions(headers, rows, categoryCol, fallbackYear, opts) {
    opts = opts || {};
    const monthCols = [];
    headers.forEach((h, i) => {
      if (i === categoryCol) return;
      const mh = parseMonthHeader(h);
      if (mh) monthCols.push({ index: i, year: mh.year != null ? mh.year : fallbackYear, month: mh.month, label: '' });
    });
    const extra = opts.extraColumns || {};
    Object.keys(extra).forEach(i => {
      const [y, mo] = String(extra[i]).split('-').map(Number);
      if (y && mo) monthCols.push({ index: +i, year: y, month: mo - 1, label: String(headers[i] || '').trim() });
    });

    const out = [];
    let categories = 0;
    eachCategoryRow(rows, categoryCol, (row, cat, section) => {
      categories++;
      const income = section === 'income' || (section === null && isIncomeLabel(cat));
      for (const mc of monthCols) {
        const amt = parseAmount(row[mc.index]);
        if (isNaN(amt) || Math.abs(amt) < 0.005 || !mc.year) continue;
        out.push({
          date: mc.year + '-' + pad(mc.month + 1) + '-01',
          amount: Math.round(Math.abs(amt) * 100) / 100,
          // Un negativo dentro de gastos es un reintegro: cuenta como ingreso.
          type: income || amt < 0 ? 'income' : 'expense',
          category: cat,
          description: mc.label,
        });
      }
    });
    return { transactions: withIds(out), skipped: 0, categories, monthColumns: monthCols };
  }

  /* Presupuestos por categoría (solo gastos) a partir de la columna de estimado. */
  function wideBudgets(rows, categoryCol, budgetCol) {
    const budgets = {};
    if (budgetCol < 0) return budgets;
    eachCategoryRow(rows, categoryCol, (row, cat, section) => {
      if (section === 'income' || (section === null && isIncomeLabel(cat))) return;
      const v = parseAmount(row[budgetCol]);
      if (v > 0) budgets[cat] = Math.round(((budgets[cat] || 0) + v) * 100) / 100;
    });
    return budgets;
  }

  const api = {
    normalize, parseAmount, parseDate, parseMonthHeader, guessMapping, guessHeaderRow,
    rowsToTransactions, wideToTransactions, wideBudgets, guessCategoryColumn, findTableEnd,
    findBudgetColumn, findExtraColumns, isLabel, txId, withIds, isIncomeLabel, toISODate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parse = api;
})(this);
