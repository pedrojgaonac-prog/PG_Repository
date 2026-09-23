// Ejecutar con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/parse.js');

test('parseAmount entiende formatos comunes', () => {
  assert.equal(P.parseAmount(12.5), 12.5);
  assert.equal(P.parseAmount('1.234,56'), 1234.56);
  assert.equal(P.parseAmount('$1,234.56'), 1234.56);
  assert.equal(P.parseAmount('45,9 €'), 45.9);
  assert.equal(P.parseAmount('1.234'), 1234);
  assert.equal(P.parseAmount('12.50'), 12.5);
  assert.equal(P.parseAmount('-30'), -30);
  assert.equal(P.parseAmount('(30)'), -30);
  assert.equal(P.parseAmount('1,234,567'), 1234567);
  assert.ok(Number.isNaN(P.parseAmount('')));
  assert.ok(Number.isNaN(P.parseAmount('abc')));
});

test('parseDate acepta Date, serial Excel y texto', () => {
  assert.equal(P.parseDate(new Date(2026, 2, 5)), '2026-03-05');
  assert.equal(P.parseDate(46086), '2026-03-05');
  assert.equal(P.parseDate('05/03/2026'), '2026-03-05');
  assert.equal(P.parseDate('5-3-26'), '2026-03-05');
  assert.equal(P.parseDate('2026-03-05'), '2026-03-05');
  assert.equal(P.parseDate('5 de marzo de 2026'), '2026-03-05');
  assert.equal(P.parseDate('03/25/2026'), '2026-03-25');
  assert.equal(P.parseDate('31/02/2026'), null);
  assert.equal(P.parseDate('hola'), null);
});

test('parseMonthHeader reconoce meses', () => {
  assert.deepEqual(P.parseMonthHeader('Enero'), { year: null, month: 0 });
  assert.deepEqual(P.parseMonthHeader('Sept. 2025'), { year: 2025, month: 8 });
  assert.deepEqual(P.parseMonthHeader('dic-25'), { year: 2025, month: 11 });
  assert.deepEqual(P.parseMonthHeader('03/2026'), { year: 2026, month: 2 });
  assert.deepEqual(P.parseMonthHeader('ENE 1A Q'), { year: null, month: 0 });
  assert.deepEqual(P.parseMonthHeader('SEP 1q'), { year: null, month: 8 });
  assert.deepEqual(P.parseMonthHeader('OCT 1 Q'), { year: null, month: 9 });
  assert.equal(P.parseMonthHeader('Premiums and bonus'), null);
  assert.equal(P.parseMonthHeader('MERCADO'), null);
  assert.equal(P.parseMonthHeader(51350.6), null);
  assert.equal(P.parseMonthHeader('Categoría'), null);
  assert.equal(P.parseMonthHeader('Total'), null);
});

test('guessMapping identifica columnas', () => {
  const m = P.guessMapping(['Fecha', 'Concepto', 'Categoría', 'Importe (€)']);
  assert.deepEqual(m, { date: 0, amount: 3, category: 2, description: 1, type: -1 });
});

test('rowsToTransactions: gastos, ingresos y filas inválidas', () => {
  const rows = [
    ['01/09/2026', 'Supermercado', 'Comida', '85,40', 'Gasto'],
    ['02/09/2026', 'Nómina', 'Sueldo', '2000', 'Ingreso'],
    ['', 'sin fecha', 'X', '10', ''],
    [null, null, null, null, null],
  ];
  const map = { date: 0, description: 1, category: 2, amount: 3, type: 4 };
  const r = P.rowsToTransactions(rows, map, {});
  assert.equal(r.transactions.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.transactions[0].type, 'expense');
  assert.equal(r.transactions[0].amount, 85.4);
  assert.equal(r.transactions[1].type, 'income');
});

test('rowsToTransactions: signo decide el tipo cuando no hay columna tipo', () => {
  const rows = [['2026-09-01', -50, 'Ocio'], ['2026-09-02', 1000, 'Sueldo']];
  const map = { date: 0, amount: 1, category: 2, description: -1, type: -1 };
  const r = P.rowsToTransactions(rows, map, { negativeMeans: 'expense', hasNegatives: true });
  assert.deepEqual(r.transactions.map(t => t.type), ['expense', 'income']);
});

test('ids estables y filas idénticas no colapsan', () => {
  const rows = [['2026-09-01', 5, 'Café'], ['2026-09-01', 5, 'Café']];
  const map = { date: 0, amount: 1, category: 2, description: -1, type: -1 };
  const a = P.rowsToTransactions(rows, map, {}).transactions;
  const b = P.rowsToTransactions(rows, map, {}).transactions;
  assert.notEqual(a[0].id, a[1].id);
  assert.deepEqual(a.map(t => t.id), b.map(t => t.id));
});

test('wideToTransactions: categorías x meses', () => {
  const headers = ['Categoría', 'Enero', 'Febrero', 'Marzo', 'Total'];
  const rows = [
    ['Alquiler', 800, 800, 800, 2400],
    ['Comida', '300,50', 280, null, 580.5],
    ['Sueldo', 2000, 2000, 2000, 6000],
    ['Total', 3100, 3080, 2800, 8980],
  ];
  const r = P.wideToTransactions(headers, rows, 0, 2026);
  assert.equal(r.monthColumns.length, 3);
  assert.equal(r.transactions.length, 8);
  assert.equal(r.transactions.find(t => t.category === 'Comida').amount, 300.5);
  assert.equal(r.transactions.find(t => t.category === 'Sueldo').type, 'income');
  assert.equal(r.transactions[0].date, '2026-01-01');
});

// Estructura tipo presupuesto: título, meses con quincena, columna ESTIMADO en la
// fila de abajo, sección INGRESOS/GASTOS, columna especial y cálculos tras RESULTADO.
function budgetSheet() {
  return [
    [1, 'PRESUPUESTO', 'PRESUPUESTO'],
    [51350.6, null, null, 'ENE 1A Q', null, 'FEB 1A Q', null, 'Premiums and bonus', null, 'MAR 1Q', null, 'TOTAL'],
    [71046.6, ' ESTIMADO ', ' REAL ', 'MENSUALIDAD', '% Del Rublo', 'MENSUALIDAD', '% Del Rublo', 'MENSUALIDAD', '%', 'MENSUALIDAD', '%', 'TOTAL'],
    ['SUELDO', 1000, 1000, 1000, 1, 1100, 1, 5000, 1, 1000, 1, 8100],
    ['TOTAL INGRESOS', 1000, 1000, 1000, 1, 1100, 1, 5000, 1, 1000, 1, 8100],
    ['GASTOS'],
    ['MERCADO', 300, 300, 320, 0.3, 310, 0.3, null, null, 290, 0.3, 920],
    ['Viene 2025', null, null, null, null, null, null, -700, null, null, null, -700],
    ['Otros', 50, null, 40, 0.1, null, null, 200, null, 10, 0, 250],
    [null, null, null, null, null, null, null, 30, null, null, null, 30],
    ['Otros', 20, null, null, null, 15, null, null, null, null, null, 15],
    ['TOTAL GASTOS', 370, 300, 360, 1, 325, 1, 230, 1, 300, 1, 1215],
    ['RESULTADO', 630, 700, 640, null, 775, null, 4770, null, 700, null, 6885],
    ['SALDO CTA AHORROS', null, 'VALIDADOR', 0, 0, 999, 0],
    [null, null, null, 'PRESUP', 'EJECUT'],
    ['DESCUENTOS', 3011089, 0.2, 2913488, 0.2, 2787120, 0.2],
  ];
}

test('tabla de presupuesto: encabezado, fin de tabla, estimado y columnas extra', () => {
  const m = budgetSheet();
  const h = P.guessHeaderRow(m);
  assert.equal(h, 1);
  const cat = P.guessCategoryColumn(m, h);
  assert.equal(cat, 0);
  const body = m.slice(h + 1);
  const end = P.findTableEnd(body, cat);
  assert.equal(body[end][0], 'RESULTADO');
  const rows = body.slice(0, end);
  const budgetCol = P.findBudgetColumn(m, h, cat);
  assert.equal(budgetCol, 1);
  assert.deepEqual(P.findExtraColumns(m[h], rows, cat, budgetCol).map(e => e.label), ['Premiums and bonus']);

  const r = P.wideToTransactions(m[h], rows, cat, 2026, {});
  const sum = (k, type) => r.transactions.filter(t => t.date.startsWith(k) && t.type === type).reduce((s, t) => s + t.amount, 0);
  assert.equal(sum('2026-01', 'expense'), 360);
  assert.equal(sum('2026-02', 'expense'), 325);
  assert.equal(sum('2026-03', 'expense'), 300);
  assert.equal(sum('2026-01', 'income'), 1000);
  assert.ok(!r.transactions.some(t => /total|resultado|descuentos|saldo/i.test(t.category)));
  assert.deepEqual(P.wideBudgets(rows, cat, budgetCol), { MERCADO: 300, Otros: 70 });
});

test('columna extra asignada a un mes y negativos como reintegro', () => {
  const m = budgetSheet();
  const rows = m.slice(2, 12);
  const r = P.wideToTransactions(m[1], rows, 0, 2026, { extraColumns: { 7: '2026-03' } });
  const extra = r.transactions.filter(t => t.description === 'Premiums and bonus');
  assert.equal(extra.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), 200);
  assert.deepEqual(extra.filter(t => t.type === 'income').map(t => [t.category, t.amount]).sort(), [['SUELDO', 5000], ['Viene 2025', 700]]);
  assert.ok(extra.every(t => t.date === '2026-03-01'));
});
