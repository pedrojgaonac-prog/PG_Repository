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

  /* Interpreta un encabezado de columna como mes. Devuelve {year|null, month} o null. */
  function parseMonthHeader(v) {
    if (v instanceof Date) return isNaN(v) ? null : { year: v.getFullYear(), month: v.getMonth() };
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) {
        const d = excelSerialToDate(v);
        return { year: d.getFullYear(), month: d.getMonth() };
      }
      return null;
    }
    const s = normalize(v).replace(/\./g, '');
    if (!s) return null;
    let m = s.match(/^([a-z]+)[\s\-/']*(?:de\s+)?(\d{2,4})?$/);
    if (m && MONTHS[m[1]] !== undefined) {
      let y = m[2] ? +m[2] : null;
      if (y !== null && y < 100) y += 2000;
      return { year: y, month: MONTHS[m[1]] };
    }
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { year: +m[2], month: +m[1] - 1 };
    m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return { year: +m[1], month: +m[2] - 1 };
    return null;
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

  /* Formato "tabla mensual": categorías en filas, un mes por columna.
     Cada celda se convierte en un movimiento el día 1 de ese mes. */
  function wideToTransactions(headers, rows, categoryCol, fallbackYear) {
    const monthCols = [];
    headers.forEach((h, i) => {
      if (i === categoryCol) return;
      const mh = parseMonthHeader(h);
      if (mh) monthCols.push({ index: i, year: mh.year != null ? mh.year : fallbackYear, month: mh.month });
    });
    const out = [];
    let skipped = 0;
    for (const row of rows) {
      if (!row || row.every(c => c == null || c === '')) continue;
      const cat = row[categoryCol] != null ? String(row[categoryCol]).trim() : '';
      if (!cat || /^total/i.test(normalize(cat))) { skipped++; continue; }
      const income = isIncomeLabel(cat);
      for (const mc of monthCols) {
        const amt = parseAmount(row[mc.index]);
        if (isNaN(amt) || amt === 0 || !mc.year) continue;
        out.push({
          date: mc.year + '-' + pad(mc.month + 1) + '-01',
          amount: Math.round(Math.abs(amt) * 100) / 100,
          type: income || amt < 0 ? 'income' : 'expense',
          category: cat,
          description: '',
        });
      }
    }
    return { transactions: withIds(out), skipped, monthColumns: monthCols };
  }

  const api = {
    normalize, parseAmount, parseDate, parseMonthHeader, guessMapping, guessHeaderRow,
    rowsToTransactions, wideToTransactions, txId, withIds, isIncomeLabel, toISODate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parse = api;
})(this);
