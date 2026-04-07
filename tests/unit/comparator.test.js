// tests/unit/comparator.test.js — Unit tests for compareTransactions
// Ported from tests/integration.test.js (5 original test cases).
// Covers: exact match, different SPEI sender, duplicate amounts on different dates,
// full 4-payout pipeline, and discrepancy detection.

'use strict';

const { compareTransactions } = require('../../src/services/comparator');

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

describe('Caso 1: Match exacto de monto (5325.55 MXN)', () => {
  let result;

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
    result = compareTransactions(singleAirbnb, singleBank);
  });

  test('debe haber exactamente 1 match', () => {
    expect(result.matched).toHaveLength(1);
  });

  test('no deben quedar payouts sin match', () => {
    expect(result.onlyInAirbnb).toHaveLength(0);
  });

  test('no deben quedar depósitos sin match', () => {
    expect(result.onlyInBank).toHaveLength(0);
  });

  test('monto Airbnb correcto (5325.55)', () => {
    expect(result.matched[0].airbnbPayout.amount).toBeCloseTo(5325.55, 2);
  });

  test('monto banco correcto (5325.55)', () => {
    expect(result.matched[0].bankDeposit.amount).toBeCloseTo(5325.55, 2);
  });

  test('diferencia de monto = 0', () => {
    expect(result.matched[0].amountDifference).toBeCloseTo(0, 2);
  });

  test('diferencia de días ≤ 2 (banco procesa en D-1 por hora de corte)', () => {
    expect(Math.abs(result.matched[0].daysDifference)).toBeLessThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 2: Match con diferente emisor SPEI (5374.80 MXN)', () => {
  let result;

  beforeAll(() => {
    const singleAirbnb = {
      payouts:     [PAYOUTS_REALES[2]],
      period:      { from: '2026-02-13', to: '2026-02-13' },
      totalAmount: 5374.80,
      source:      'airbnb_csv',
    };
    const singleBank = {
      bankPdf1: {
        airbnbDeposits: [DEPOSITOS_BBVA_PDF1[2]],
        allDeposits:    [DEPOSITOS_BBVA_PDF1[2]],
        period:         { from: '2026-02-13', to: '2026-02-28' },
      },
      bankPdf2: null,
    };
    result = compareTransactions(singleAirbnb, singleBank);
  });

  test('debe haber exactamente 1 match', () => {
    expect(result.matched).toHaveLength(1);
  });

  test('monto Airbnb correcto (5374.80)', () => {
    expect(result.matched[0].airbnbPayout.amount).toBeCloseTo(5374.80, 2);
  });

  test('diferencia de monto = 0', () => {
    expect(result.matched[0].amountDifference).toBeCloseTo(0, 2);
  });

  test('daysDifference = 0 (misma fecha)', () => {
    expect(result.matched[0].daysDifference).toBe(0);
  });

  test('descripción del depósito contiene "SPEI RECIBIDO"', () => {
    expect(result.matched[0].bankDeposit.description).toMatch(/SPEI\s*RECIBIDO/i);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 3: Dos montos iguales en fechas distintas (3415.67 × 2)', () => {
  let result;

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
    result = compareTransactions(dualAirbnb, dualBank);
  });

  test('deben haber exactamente 2 matches', () => {
    expect(result.matched).toHaveLength(2);
  });

  test('no deben quedar payouts sin match', () => {
    expect(result.onlyInAirbnb).toHaveLength(0);
  });

  test('no deben quedar depósitos sin match', () => {
    expect(result.onlyInBank).toHaveLength(0);
  });

  test('los dos matches tienen fechas de depósito distintas (sin duplicación)', () => {
    const fechas = result.matched.map(m => m.bankDeposit.date);
    expect(fechas[0]).not.toBe(fechas[1]);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 4: Pipeline completo (4 payouts, 2 PDFs bancarios)', () => {
  let result;

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
    result = compareTransactions(airbnbData, bankData);
  });

  test('4 payouts deben coincidir con 4 depósitos', () => {
    expect(result.matched).toHaveLength(4);
  });

  test('sin payouts pendientes', () => {
    expect(result.onlyInAirbnb).toHaveLength(0);
  });

  test('sin depósitos sin registro', () => {
    expect(result.onlyInBank).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────

describe('Caso 5: Payout sin depósito bancario (discrepancia)', () => {
  let result;

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

    result = compareTransactions(airbnbConExtra, bankData);
  });

  test('4 matches para los payouts reales', () => {
    expect(result.matched).toHaveLength(4);
  });

  test('1 payout sin depósito bancario', () => {
    expect(result.onlyInAirbnb).toHaveLength(1);
  });

  test('el payout pendiente es el de 9999.00', () => {
    expect(result.onlyInAirbnb[0].amount).toBeCloseTo(9999.00, 2);
  });
});
