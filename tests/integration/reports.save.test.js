// tests/integration/reports.save.test.js — DEV-003
// Cobertura de integración para POST /api/reports/save.
// Verifica que excelData.noches y excelData.comisionAirbnb se calculen correctamente
// desde tables.matched[].reservations y tables.onlyInAirbnb[].reservations
// cuando la sesión no está disponible (Fuente 2, DEV-003).

'use strict';

jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

// Mock SessionStore — permite controlar si hay sesión activa en cada test.
// Por defecto retorna null (sin sesión). Sobreescribir con mockReturnValueOnce en tests específicos.
jest.mock('../../src/store/SessionStore', () => ({
  get: jest.fn(() => null),
  create: jest.fn(),
  destroy: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initSchema } = require('../../src/database/schema');
const authRoutes = require('../../src/routes/auth.routes');
const reportsRoutes = require('../../src/routes/reports.routes');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { pool } = require('../../src/database/client');
const SessionStore = require('../../src/store/SessionStore');

// ── Fixtures ───────────────────────────────────────────────────

const VALID_USER = {
  username: 'savereportuser',
  email: 'savereport@example.com',
  password: 'password123',
};

/** Construye una reservación con los campos relevantes para DEV-003 */
function buildReservation({ nights = 0, serviceFee = 0 } = {}) {
  return {
    confirmationCode: 'ABC123',
    guest: 'Test Guest',
    checkIn: '2026-02-10',
    checkOut: '2026-02-15',
    nights,
    grossAmount: 3000,
    serviceFee,
    cleaningFee: 0,
    netAmount: 3000,
  };
}

/** Construye un entry de tables.matched con las reservaciones indicadas */
function buildMatchedEntry(reservations) {
  return {
    airbnbDate: '2026-02-15',
    bankDate: '2026-02-17',
    daysDifference: 2,
    airbnbAmount: 3415.67,
    bankAmount: 3415.67,
    amountDifference: 0,
    currency: 'MXN',
    referenceCode: 'AIRPAY123',
    bankDescription: 'SPEI',
    bankReference: 'REF123',
    reservations,
    status: 'matched',
  };
}

/** Construye un entry de tables.onlyInAirbnb con las reservaciones indicadas */
function buildOnlyAirbnbEntry(reservations) {
  return {
    date: '2026-02-20',
    amount: 2500,
    currency: 'MXN',
    referenceCode: 'AIRPAY456',
    reservations,
    label: 'Pendiente',
  };
}

/** Payload mínimo válido para POST /api/reports/save */
function buildReport({ tables, month = '2026-02' } = {}) {
  return {
    month,
    label: 'Febrero 2026',
    summary: {
      reportMonth: month,
      reportLabel: 'Febrero 2026',
      totalAirbnbPayouts: 10000,
      totalBankDeposits: 10000,
      matchRate: '100%',
    },
    tables: tables ?? {
      matched: [],
      onlyInAirbnb: [],
      onlyInBank: [],
      differences: [],
    },
  };
}

/** Lee el excelData del único reporte guardado en DB */
async function getSavedExcelData() {
  const { rows } = await pool.query('SELECT summary FROM reports LIMIT 1');
  if (!rows.length) return null;
  return JSON.parse(rows[0].summary).excelData;
}

// ── App setup ─────────────────────────────────────────────────

let app;
let authCookie;

beforeAll(async () => {
  await initSchema();

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use(errorHandler);
});

// ── Setup / Teardown ───────────────────────────────────────────

// Cada test parte de DB limpia, usuario fresco y sin sesión activa (Fuente 2 activada)
beforeEach(async () => {
  await pool.query('DELETE FROM reports');
  await pool.query('DELETE FROM properties');
  await pool.query('DELETE FROM users');

  const res = await request(app).post('/api/auth/register').send(VALID_USER);
  authCookie = res.headers['set-cookie'];

  // Sin sesión activa por defecto — garantiza que Fuente 2 (DEV-003) sea la que actúa
  SessionStore.get.mockReturnValue(null);
});

// ── Autenticación y validación básica ─────────────────────────

describe('POST /api/reports/save — autenticación y validación', () => {
  test('devuelve 401 sin cookie de sesión', async () => {
    const res = await request(app).post('/api/reports/save').send(buildReport());
    expect(res.status).toBe(401);
  });

  test('devuelve 400 cuando el body está vacío', async () => {
    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('devuelve 400 cuando el body no tiene campo summary', async () => {
    const res = await request(app)
      .post('/api/reports/save')
      .set('Cookie', authCookie)
      .send({ month: '2026-02', tables: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/summary/i);
  });
});

// ── DEV-003: noches desde tables ──────────────────────────────

describe('POST /api/reports/save — DEV-003: cálculo de noches desde tables', () => {
  test('calcula noches desde matched[].reservations[].nights', async () => {
    const report = buildReport({
      tables: {
        matched: [buildMatchedEntry([buildReservation({ nights: 5 })])],
        onlyInAirbnb: [],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(5);
  });

  test('calcula noches desde onlyInAirbnb[].reservations[].nights', async () => {
    const report = buildReport({
      tables: {
        matched: [],
        onlyInAirbnb: [buildOnlyAirbnbEntry([buildReservation({ nights: 6 })])],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(6);
  });

  test('acumula noches de múltiples reservations dentro del mismo entry y entre entries', async () => {
    // matched con 2 reservaciones (3 + 4 noches) + onlyInAirbnb con 1 (2 noches) = 9
    const report = buildReport({
      tables: {
        matched: [
          buildMatchedEntry([buildReservation({ nights: 3 }), buildReservation({ nights: 4 })]),
        ],
        onlyInAirbnb: [buildOnlyAirbnbEntry([buildReservation({ nights: 2 })])],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(9);
  });
});

// ── DEV-003: comisionAirbnb desde tables ─────────────────────

describe('POST /api/reports/save — DEV-003: cálculo de comisionAirbnb desde tables', () => {
  test('calcula comisionAirbnb desde matched[].reservations[].serviceFee (signo negativo → magnitud positiva)', async () => {
    const report = buildReport({
      tables: {
        matched: [buildMatchedEntry([buildReservation({ serviceFee: -200 })])],
        onlyInAirbnb: [],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.comisionAirbnb).toBe(200); // Math.abs(-200)
  });

  test('calcula comisionAirbnb desde onlyInAirbnb[].reservations[].serviceFee', async () => {
    const report = buildReport({
      tables: {
        matched: [],
        onlyInAirbnb: [buildOnlyAirbnbEntry([buildReservation({ serviceFee: -150 })])],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.comisionAirbnb).toBe(150); // Math.abs(-150)
  });

  test('acumula serviceFee de múltiples reservations entre matched y onlyInAirbnb', async () => {
    // matched: [-200, -100] + onlyInAirbnb: [-50] → 200 + 100 + 50 = 350
    const report = buildReport({
      tables: {
        matched: [
          buildMatchedEntry([
            buildReservation({ serviceFee: -200 }),
            buildReservation({ serviceFee: -100 }),
          ]),
        ],
        onlyInAirbnb: [buildOnlyAirbnbEntry([buildReservation({ serviceFee: -50 })])],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.comisionAirbnb).toBe(350);
  });
});

// ── DEV-003: robustez con reservations ausentes ───────────────

describe('POST /api/reports/save — DEV-003: reservations null, undefined o vacío', () => {
  test('no rompe el save cuando reservations es undefined en un entry de matched', async () => {
    const entryWithoutReservations = {
      ...buildMatchedEntry([]),
      reservations: undefined,
    };
    const report = buildReport({
      tables: {
        matched: [entryWithoutReservations],
        onlyInAirbnb: [],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(0);
    expect(excelData.comisionAirbnb).toBe(0);
  });

  test('no rompe el save cuando reservations es null en un entry de onlyInAirbnb', async () => {
    const entryNullRes = { ...buildOnlyAirbnbEntry([]), reservations: null };
    const report = buildReport({
      tables: {
        matched: [],
        onlyInAirbnb: [entryNullRes],
        onlyInBank: [],
        differences: [],
      },
    });

    const res = await request(app).post('/api/reports/save').set('Cookie', authCookie).send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(0);
    expect(excelData.comisionAirbnb).toBe(0);
  });

  test('no rompe el save cuando tables está ausente del body', async () => {
    const { tables: _omitted, ...reportSinTables } = buildReport();

    const res = await request(app)
      .post('/api/reports/save')
      .set('Cookie', authCookie)
      .send(reportSinTables);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    expect(excelData.noches).toBe(0);
    expect(excelData.comisionAirbnb).toBe(0);
  });
});

// ── Prioridad Fuente 1 (sesión) > Fuente 2 (tables) ──────────

describe('POST /api/reports/save — Fuente 1 (sesión) tiene prioridad sobre Fuente 2 (tables)', () => {
  test('cuando la sesión está activa, usa airbnbData.payouts y no lee tables.reservations', async () => {
    // Sesión activa con 3 noches. Tables tienen 10 noches distintas.
    // El resultado debe ser 3 (Fuente 1), no 10 (Fuente 2).
    SessionStore.get.mockReturnValueOnce({
      airbnbData: {
        payouts: [{ reservations: [{ nights: 3, serviceFee: -75 }] }],
      },
    });

    const report = buildReport({
      tables: {
        matched: [buildMatchedEntry([buildReservation({ nights: 10, serviceFee: -500 })])],
        onlyInAirbnb: [],
        onlyInBank: [],
        differences: [],
      },
    });

    // X-Session-Id es necesario para que saveReport llame SessionStore.get y active Fuente 1.
    // Sin este header, sessionId === null y session === null sin invocar el mock.
    const res = await request(app)
      .post('/api/reports/save')
      .set('Cookie', authCookie)
      .set('X-Session-Id', 'fake-session-id')
      .send(report);

    expect(res.status).toBe(200);
    const excelData = await getSavedExcelData();
    // Fuente 1 gana: noches = 3, no 10
    expect(excelData.noches).toBe(3);
    // comisionAirbnb viene de Fuente 1 (no 500 de tables)
    expect(excelData.comisionAirbnb).not.toBe(500);
  });
});
