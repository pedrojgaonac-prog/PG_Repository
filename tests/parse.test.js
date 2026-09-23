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
