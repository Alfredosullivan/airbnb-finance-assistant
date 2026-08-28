// tests/integration/upload.test.js — Test de integración para endpoints de upload
// Verifica que los endpoints protegidos devuelvan 401 cuando no hay autenticación.
// Usa una app Express mínima con las rutas de finance incluidas.

'use strict';

// Deshabilitar rate limiting en tests (mismo patrón que auth.test.js)
jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initSchema } = require('../../src/database/schema');
const financeRoutes = require('../../src/routes/finance.routes');
const { errorHandler } = require('../../src/middleware/errorHandler');

let app;

beforeAll(async () => {
  // Inicializar pg-mem antes de cargar las rutas que dependen del DB client
  await initSchema();

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api', financeRoutes);
  app.use(errorHandler);
});

// ── T4 — Upload sin autenticación devuelve 401 ───────────────────

describe('T4 — Endpoints de upload requieren autenticación', () => {
  test('POST /api/upload/airbnb sin token devuelve 401', async () => {
    // requireAuth corre antes de multer — no se necesita adjuntar un archivo real
    const res = await request(app).post('/api/upload/airbnb');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/upload/bank sin token devuelve 401', async () => {
    const res = await request(app).post('/api/upload/bank');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('GET /api/report sin token devuelve 401', async () => {
    const res = await request(app).get('/api/report');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/reset sin token devuelve 401', async () => {
    const res = await request(app).post('/api/reset');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});
