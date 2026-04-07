// tests/unit/formatter.test.js — Unit tests for formatReport
// Ported from tests/integration.test.js (5 original test cases).
// Covers: status OK, bankSources counts, totals, matchRate, averageDaysToDeposit,
// all-matched status field, DISCREPANCY detection, and "Pendiente" label.

'use strict';

const { compareTransactions } = require('../../src/services/comparator');
const { formatReport }        = require('../../src/utils/formatter');

// ── Silence comparator's diagnostic console.log during tests ────
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
});

// ── Shared fixtures (mirrored from integration.test.js) ─────────

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

// ── Test suites ──────────────────────────────────────────────────

describe('Caso 1: formatReport con match exacto (5325.55 MXN)', () => {
  let report;

  beforeAll(() => {
    const singleAirbnb = {
      payouts:     [PAYOUTS_REALES[0]],
      period:      { from: '2026-01-02', to: '2026-01-02' },
      totalAmount: 5325.55,
      source:      'airbnb_csv',
    };
    const singleBank = {
      bankPdf1: {
        airbnbDeposits: [DEPOSITOS_BBVA_PDF1[0]],
        allDeposits:    [DEPOSITOS_BBVA_PDF1[0]],
        period:         { from: '2026-01-01', to: '2026-01-31' },
      },
      bankPdf2: null,
    };
    report = formatReport(compareTransactions(singleAirbnb, singleBank));
  });

  test('status del reporte = "OK"', () => {
    expect(report.summary.status).toBe('OK');
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 3: formatReport con dos montos iguales en fechas distintas', () => {
  let report;

  beforeAll(() => {
    const dualAirbnb = {
      payouts:     [PAYOUTS_REALES[1], PAYOUTS_REALES[3]],
      period:      { from: '2026-02-07', to: '2026-02-28' },
      totalAmount: 3415.67 * 2,
      source:      'airbnb_csv',
    };
    const dualBank = {
      bankPdf1: {
        airbnbDeposits: [DEPOSITOS_BBVA_PDF1[1]],
        allDeposits:    [DEPOSITOS_BBVA_PDF1[1]],
        period:         { from: '2026-01-13', to: '2026-02-12' },
      },
      bankPdf2: {
        airbnbDeposits: [DEPOSITOS_BBVA_PDF2[0]],
        allDeposits:    [DEPOSITOS_BBVA_PDF2[0]],
        period:         { from: '2026-02-13', to: '2026-03-12' },
      },
    };
    report = formatReport(compareTransactions(dualAirbnb, dualBank));
  });

  test('total Airbnb correcto (3415.67 × 2 = 6831.34)', () => {
    expect(report.summary.totalAirbnbPayouts).toBeCloseTo(6831.34, 2);
  });

  test('total banco correcto (3415.67 × 2 = 6831.34)', () => {
    expect(report.summary.totalBankDeposits).toBeCloseTo(6831.34, 2);
  });

  test('diferencia = 0', () => {
    expect(report.summary.difference).toBeCloseTo(0, 2);
  });

  test('status = "OK"', () => {
    expect(report.summary.status).toBe('OK');
  });

  test('PDF1: 1 transacción', () => {
    expect(report.bankSources.pdf1Transactions).toBe(1);
  });

  test('PDF2: 1 transacción', () => {
    expect(report.bankSources.pdf2Transactions).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 4: formatReport con pipeline completo (4 payouts, 2 PDFs)', () => {
  let report;

  beforeAll(() => {
    const airbnbData = {
      payouts:     PAYOUTS_REALES,
      period:      { from: '2026-01-02', to: '2026-02-28' },
      totalAmount: PAYOUTS_REALES.reduce((s, p) => s + p.amount, 0),
      source:      'airbnb_csv',
    };
    const bankData = {
      bankPdf1: {
        period:         { from: '2026-01-13', to: '2026-02-12' },
        airbnbDeposits: DEPOSITOS_BBVA_PDF1,
        allDeposits:    DEPOSITOS_BBVA_PDF1,
        source:         'bbva_pdf',
      },
      bankPdf2: {
        period:         { from: '2026-02-13', to: '2026-03-12' },
        airbnbDeposits: DEPOSITOS_BBVA_PDF2,
        allDeposits:    DEPOSITOS_BBVA_PDF2,
        source:         'bbva_pdf',
      },
    };
    report = formatReport(compareTransactions(airbnbData, bankData));
  });

  test('match rate = "100%"', () => {
    expect(report.summary.matchRate).toBe('100%');
  });

  test('diferencia total = 0', () => {
    expect(report.summary.difference).toBeCloseTo(0, 2);
  });

  test('status global = "OK"', () => {
    expect(report.summary.status).toBe('OK');
  });

  test('PDF1: 3 transacciones', () => {
    expect(report.bankSources.pdf1Transactions).toBe(3);
  });

  test('PDF2: 1 transacción', () => {
    expect(report.bankSources.pdf2Transactions).toBe(1);
  });

  test('total bancario: 4 transacciones', () => {
    expect(report.bankSources.totalTransactions).toBe(4);
  });

  test('promedio de días es un número', () => {
    expect(typeof report.summary.averageDaysToDeposit).toBe('number');
  });

  test('todos los matches tienen status "matched"', () => {
    expect(report.matched.every(m => m.status === 'matched')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 5: formatReport con payout sin depósito bancario (discrepancia)', () => {
  let report;

  beforeAll(() => {
    const bankData = {
      bankPdf1: {
        period:         { from: '2026-01-13', to: '2026-02-12' },
        airbnbDeposits: DEPOSITOS_BBVA_PDF1,
        allDeposits:    DEPOSITOS_BBVA_PDF1,
        source:         'bbva_pdf',
      },
      bankPdf2: {
        period:         { from: '2026-02-13', to: '2026-03-12' },
        airbnbDeposits: DEPOSITOS_BBVA_PDF2,
        allDeposits:    DEPOSITOS_BBVA_PDF2,
        source:         'bbva_pdf',
      },
    };
    const airbnbConExtra = {
      payouts: [
        ...PAYOUTS_REALES,
        {
          date:          '2026-03-01',
          amount:        9999.00,
          currency:      'MXN',
          referenceCode: 'REF_EXTRA',
          reservations:  [],
          taxWithholdings: { isr: 0, iva: 0, hostTax: 0 },
          source:        'airbnb_csv',
        },
      ],
      period:      { from: '2026-01-02', to: '2026-03-01' },
      totalAmount: PAYOUTS_REALES.reduce((s, p) => s + p.amount, 0) + 9999.00,
      source:      'airbnb_csv',
    };
    report = formatReport(compareTransactions(airbnbConExtra, bankData));
  });

  test('status = "DISCREPANCY" cuando hay diferencia', () => {
    expect(report.summary.status).toBe('DISCREPANCY');
  });

  test('label "Pendiente" en el payout sin depósito bancario', () => {
    expect(report.onlyInAirbnb[0].label).toBe('Pendiente');
  });
});
