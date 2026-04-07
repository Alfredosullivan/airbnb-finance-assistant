// tests/integration.test.js — Tests de integración del pipeline Airbnb → BBVA
// Ejercita csvParser → comparator → formatter con datos reales de los archivos analizados
// Ejecutar con: node tests/integration.test.js

'use strict';

const { compareTransactions } = require('../src/services/comparator');
const { formatReport }        = require('../src/utils/formatter');

// ── Utilidades de aserción mínimas (sin framework externo) ─────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FALLO: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✓ ${message} (${actual})`);
    passed++;
  } else {
    console.error(`  ✗ FALLO: ${message} — esperado: ${expected}, obtenido: ${actual}`);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) <= tolerance) {
    console.log(`  ✓ ${message} (${actual})`);
    passed++;
  } else {
    console.error(`  ✗ FALLO: ${message} — esperado ≈${expected} (±${tolerance}), obtenido: ${actual}`);
    failed++;
  }
}

// ── Fixtures de datos reales ───────────────────────────────────

// Airbnb CSV: Payouts del período enero-febrero 2026
const PAYOUTS_REALES = [
  {
    date:          '2026-01-02',
    amount:        5325.55,
    currency:      'MXN',
    referenceCode: 'REF_JAN02',
    reservations:  [{ confirmationCode: 'HMRES001', guest: 'Huésped A', nights: 3, netAmount: 5325.55 }],
    taxWithholdings: { isr: -213.02, iva: -426.04, hostTax: 852.08 },
    source: 'airbnb_csv',
  },
  {
    date:          '2026-02-07',
    amount:        3415.67,
    currency:      'MXN',
    referenceCode: 'REF_FEB07',
    reservations:  [{ confirmationCode: 'HMRES002', guest: 'Huésped B', nights: 2, netAmount: 3415.67 }],
    taxWithholdings: { isr: -136.63, iva: -273.25, hostTax: 546.51 },
    source: 'airbnb_csv',
  },
  {
    date:          '2026-02-13',
    amount:        5374.80,
    currency:      'MXN',
    referenceCode: 'REF_FEB13',
    reservations:  [{ confirmationCode: 'HMRES003', guest: 'Huésped C', nights: 4, netAmount: 5374.80 }],
    taxWithholdings: { isr: -214.99, iva: -429.98, hostTax: 859.97 },
    source: 'airbnb_csv',
  },
  {
    date:          '2026-02-28',
    amount:        3415.67,
    currency:      'MXN',
    referenceCode: 'REF_FEB28',
    reservations:  [{ confirmationCode: 'HMRES004', guest: 'Huésped D', nights: 2, netAmount: 3415.67 }],
    taxWithholdings: { isr: -136.63, iva: -273.25, hostTax: 546.51 },
    source: 'airbnb_csv',
  },
];

// BBVA PDF 1 (enero-febrero 2026): depósitos SPEI de Airbnb
const DEPOSITOS_BBVA_PDF1 = [
  {
    date:            '2026-01-01',
    liquidationDate: '2026-01-03',
    amount:          5325.55,
    description:     'SPEI RECIBIDOARCUS FI',
    reference:       '1394745581394745',
    currency:        'MXN',
    type:            'airbnb_deposit',
    source:          'bbva_pdf',
  },
  {
    date:            '2026-02-07',
    liquidationDate: '2026-02-09',
    amount:          3415.67,
    description:     'SPEI RECIBIDOSTP DLOCAL_MEX',
    reference:       '2394745581394746',
    currency:        'MXN',
    type:            'airbnb_deposit',
    source:          'bbva_pdf',
  },
  {
    date:            '2026-02-13',
    liquidationDate: '2026-02-14',
    amount:          5374.80,
    description:     'SPEI RECIBIDOSTP DLOCAL_MEX',
    reference:       '3394745581394747',
    currency:        'MXN',
    type:            'airbnb_deposit',
    source:          'bbva_pdf',
  },
];

// BBVA PDF 2 (febrero-marzo 2026): segundo PDF bancario con el payout de feb/28
const DEPOSITOS_BBVA_PDF2 = [
  {
    date:            '2026-02-28',
    liquidationDate: '2026-03-01',
    amount:          3415.67,
    description:     'SPEI RECIBIDOARCUS FI',
    reference:       '4394745581394748',
    currency:        'MXN',
    type:            'airbnb_deposit',
    source:          'bbva_pdf',
  },
];

// ── Wrapper de airbnbData para el comparator ───────────────────
const airbnbData = {
  payouts:     PAYOUTS_REALES,
  period:      { from: '2026-01-02', to: '2026-02-28' },
  totalAmount: PAYOUTS_REALES.reduce((s, p) => s + p.amount, 0),
  source:      'airbnb_csv',
};

// ── Wrapper de bankData para el comparator ─────────────────────
const bankData = {
  bankPdf1: {
    period:          { from: '2026-01-13', to: '2026-02-12' },
    airbnbDeposits:  DEPOSITOS_BBVA_PDF1,
    allDeposits:     DEPOSITOS_BBVA_PDF1,
    source:          'bbva_pdf',
  },
  bankPdf2: {
    period:          { from: '2026-02-13', to: '2026-03-12' },
    airbnbDeposits:  DEPOSITOS_BBVA_PDF2,
    allDeposits:     DEPOSITOS_BBVA_PDF2,
    source:          'bbva_pdf',
  },
};

// ──────────────────────────────────────────────────────────────
// CASO 1 — Match exacto de monto entre Payout y depósito BBVA
// Airbnb: 02/01/2026, Payout = 5325.55 MXN
// BBVA:   01/ENE, SPEI RECIBIDOARCUS FI, abono = 5325.55
// Resultado esperado: matched, daysDifference = -1 (banco un día antes por hora de corte)
// ──────────────────────────────────────────────────────────────
console.log('\n━━━ Caso 1: Match exacto de monto (5325.55 MXN) ━━━━━━━━━━━━');
{
  const singleAirbnb = {
    payouts: [PAYOUTS_REALES[0]],
    period:  { from: '2026-01-02', to: '2026-01-02' },
    totalAmount: 5325.55,
    source: 'airbnb_csv',
  };
  const singleBank = {
    bankPdf1: { airbnbDeposits: [DEPOSITOS_BBVA_PDF1[0]], allDeposits: [DEPOSITOS_BBVA_PDF1[0]], period: { from: '2026-01-01', to: '2026-01-31' } },
    bankPdf2: null,
  };

  const result = compareTransactions(singleAirbnb, singleBank);
  const report = formatReport(result);

  assertEqual(result.matched.length, 1, 'Debe haber exactamente 1 match');
  assertEqual(result.onlyInAirbnb.length, 0, 'No deben quedar payouts sin match');
  assertEqual(result.onlyInBank.length, 0, 'No deben quedar depósitos sin match');
  assertClose(result.matched[0].airbnbPayout.amount, 5325.55, 0.01, 'Monto Airbnb correcto');
  assertClose(result.matched[0].bankDeposit.amount, 5325.55, 0.01, 'Monto banco correcto');
  assertClose(result.matched[0].amountDifference, 0, 0.01, 'Diferencia de monto = 0');
  assert(Math.abs(result.matched[0].daysDifference) <= 2, 'Diferencia de días ≤ 2');
  assertEqual(report.summary.status, 'OK', 'Status del reporte = OK');
}

// ──────────────────────────────────────────────────────────────
// CASO 2 — Match con diferente emisor (DLOCAL en lugar de ARCUS FI)
// Airbnb: 02/13/2026, Payout = 5374.80 MXN
// BBVA:   13/FEB, SPEI RECIBIDOSTP DLOCAL_MEX, abono = 5374.80
// Resultado esperado: matched, daysDifference = 0 (misma fecha)
// ──────────────────────────────────────────────────────────────
console.log('\n━━━ Caso 2: Match con diferente emisor SPEI (5374.80 MXN) ━━');
{
  const singleAirbnb = {
    payouts: [PAYOUTS_REALES[2]],
    period:  { from: '2026-02-13', to: '2026-02-13' },
    totalAmount: 5374.80,
    source: 'airbnb_csv',
  };
  const singleBank = {
    bankPdf1: { airbnbDeposits: [DEPOSITOS_BBVA_PDF1[2]], allDeposits: [DEPOSITOS_BBVA_PDF1[2]], period: { from: '2026-02-13', to: '2026-02-28' } },
    bankPdf2: null,
  };

  const result = compareTransactions(singleAirbnb, singleBank);

  assertEqual(result.matched.length, 1, 'Debe haber exactamente 1 match');
  assertClose(result.matched[0].airbnbPayout.amount, 5374.80, 0.01, 'Monto Airbnb correcto');
  assertClose(result.matched[0].amountDifference, 0, 0.01, 'Diferencia de monto = 0');
  assertEqual(result.matched[0].daysDifference, 0, 'daysDifference = 0 (misma fecha)');
  assert(
    /SPEI\s*RECIBIDO/i.test(result.matched[0].bankDeposit.description),
    'Descripción contiene SPEI RECIBIDO'
  );
}

// ──────────────────────────────────────────────────────────────
// CASO 3 — Dos montos iguales (3415.67) en fechas distintas
// Airbnb: 02/07/2026 y 02/28/2026, ambos Payout = 3415.67 MXN
// BBVA:   PDF1 tiene 3415.67 el 02/07; PDF2 tiene 3415.67 el 02/28
// Resultado esperado: 2 matches separados, sin duplicar
// ──────────────────────────────────────────────────────────────
console.log('\n━━━ Caso 3: Dos montos iguales en fechas distintas (3415.67) ━');
{
  const dualAirbnb = {
    payouts: [PAYOUTS_REALES[1], PAYOUTS_REALES[3]],
    period:  { from: '2026-02-07', to: '2026-02-28' },
    totalAmount: 3415.67 * 2,
    source: 'airbnb_csv',
  };
  const dualBank = {
    bankPdf1: {
      airbnbDeposits: [DEPOSITOS_BBVA_PDF1[1]],
      allDeposits:    [DEPOSITOS_BBVA_PDF1[1]],
      period: { from: '2026-01-13', to: '2026-02-12' },
    },
    bankPdf2: {
      airbnbDeposits: [DEPOSITOS_BBVA_PDF2[0]],
      allDeposits:    [DEPOSITOS_BBVA_PDF2[0]],
      period: { from: '2026-02-13', to: '2026-03-12' },
    },
  };

  const result = compareTransactions(dualAirbnb, dualBank);
  const report = formatReport(result);

  assertEqual(result.matched.length, 2, 'Deben haber exactamente 2 matches');
  assertEqual(result.onlyInAirbnb.length, 0, 'No deben quedar payouts sin match');
  assertEqual(result.onlyInBank.length, 0, 'No deben quedar depósitos sin match');

  // Verificar que no se duplicaron: los dos matches deben tener fechas distintas
  const fechas = result.matched.map(m => m.bankDeposit.date);
  assert(fechas[0] !== fechas[1], 'Los dos matches tienen fechas de depósito distintas');

  // Verificar totales del reporte
  assertClose(report.summary.totalAirbnbPayouts, 6831.34, 0.01, 'Total Airbnb correcto (3415.67 × 2)');
  assertClose(report.summary.totalBankDeposits,  6831.34, 0.01, 'Total banco correcto (3415.67 × 2)');
  assertClose(report.summary.difference, 0, 0.01, 'Diferencia = 0');
  assertEqual(report.summary.status, 'OK', 'Status = OK');
  assertEqual(report.bankSources.pdf1Transactions, 1, 'PDF1: 1 transacción');
  assertEqual(report.bankSources.pdf2Transactions, 1, 'PDF2: 1 transacción');
}

// ──────────────────────────────────────────────────────────────
// CASO 4 — Pipeline completo con todos los Payouts reales
// 4 payouts de Airbnb cruzados contra PDF1 (3 depósitos) + PDF2 (1 depósito)
// ──────────────────────────────────────────────────────────────
console.log('\n━━━ Caso 4: Pipeline completo (4 payouts, 2 PDFs bancarios) ━━');
{
  const result = compareTransactions(airbnbData, bankData);
  const report = formatReport(result);

  assertEqual(result.matched.length, 4, '4 payouts deben coincidir con 4 depósitos');
  assertEqual(result.onlyInAirbnb.length, 0, 'Sin payouts pendientes');
  assertEqual(result.onlyInBank.length, 0, 'Sin depósitos sin registro');
  assertEqual(report.summary.matchRate, '100%', 'Match rate = 100%');
  assertClose(report.summary.difference, 0, 0.01, 'Diferencia total = 0');
  assertEqual(report.summary.status, 'OK', 'Status global = OK');
  assertEqual(report.bankSources.pdf1Transactions, 3, 'PDF1: 3 transacciones');
  assertEqual(report.bankSources.pdf2Transactions, 1, 'PDF2: 1 transacción');
  assertEqual(report.bankSources.totalTransactions, 4, 'Total bancario: 4 transacciones');
  // El promedio puede ser negativo si el banco procesa el SPEI antes de la fecha del Payout
  // (ocurre cuando BBVA liquida en D-1 por diferencias de horario de corte)
  assert(typeof report.summary.averageDaysToDeposit === 'number', 'Promedio de días es un número');
  assert(report.matched.every(m => m.status === 'matched'), 'Todos los matches con status "matched"');
}

// ──────────────────────────────────────────────────────────────
// CASO 5 — Discrepancia: Payout sin depósito bancario
// ──────────────────────────────────────────────────────────────
console.log('\n━━━ Caso 5: Payout sin depósito bancario (discrepancia) ━━━━━');
{
  const airbnbConExtra = {
    payouts: [
      ...PAYOUTS_REALES,
      {
        date: '2026-03-01', amount: 9999.00, currency: 'MXN',
        referenceCode: 'REF_EXTRA', reservations: [], taxWithholdings: { isr: 0, iva: 0, hostTax: 0 },
        source: 'airbnb_csv',
      },
    ],
    period: { from: '2026-01-02', to: '2026-03-01' },
    totalAmount: PAYOUTS_REALES.reduce((s, p) => s + p.amount, 0) + 9999.00,
    source: 'airbnb_csv',
  };

  const result = compareTransactions(airbnbConExtra, bankData);
  const report = formatReport(result);

  assertEqual(result.matched.length, 4, '4 matches para los payouts reales');
  assertEqual(result.onlyInAirbnb.length, 1, '1 payout sin depósito bancario');
  assertClose(result.onlyInAirbnb[0].amount, 9999.00, 0.01, 'El payout pendiente es el de 9999.00');
  assert(report.summary.status === 'DISCREPANCY', 'Status = DISCREPANCY cuando hay diferencia');
  assert(report.onlyInAirbnb[0].label === 'Pendiente', 'Label "Pendiente" en onlyInAirbnb');
}

// ── Resumen final ──────────────────────────────────────────────
console.log('\n' + '═'.repeat(52));
console.log(`  Total: ${passed + failed} pruebas | ✓ ${passed} pasaron | ✗ ${failed} fallaron`);
console.log('═'.repeat(52) + '\n');

process.exit(failed > 0 ? 1 : 0);
