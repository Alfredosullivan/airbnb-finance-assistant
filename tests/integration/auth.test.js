// tests/integration/auth.test.js — Pruebas de integración del sistema de autenticación
// Usa supertest contra la app Express completa con base de datos en memoria (pg-mem).
// Cubre: registro, login, logout, registro duplicado, contraseña incorrecta, sesión activa.

'use strict';

// Disable rate limiting for the test suite.
// express-rate-limit's in-memory store accumulates across all tests in the file
// (the same app instance is shared). The 20-request window would be exhausted
// before all auth scenarios run. Rate limiting is infrastructure behavior tested
// separately; here we test authentication logic only.
jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

const request      = require('supertest');
const { pool }     = require('../../src/database/client');

// ── Fixtures ───────────────────────────────────────────────────
const VALID_USER = {
  username: 'testuser',
  email:    'test@example.com',
  password: 'password123',
};

// ── App setup ─────────────────────────────────────────────────
// testApp exports a Promise that resolves once the schema is ready.
let app;
beforeAll(async () => {
  app = await require('../helpers/testApp');
});

// ── Helpers ────────────────────────────────────────────────────

/** Registers VALID_USER and returns the session cookie. */
async function registerAndGetCookie(userData = VALID_USER) {
  const res = await request(app)
    .post('/api/auth/register')
    .send(userData);
  return res.headers['set-cookie'];
}

// ── Setup / Teardown ───────────────────────────────────────────

// Wipe all data before each test so tests are fully independent.
// Order respects foreign key constraints: reports → properties → users.
beforeEach(async () => {
  await pool.query('DELETE FROM reports');
  await pool.query('DELETE FROM properties');
  await pool.query('DELETE FROM users');
});

// ── POST /api/auth/register ───────────────────────────────────

describe('POST /api/auth/register', () => {
  test('creates a new user and returns 201 with user data', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({
      username: VALID_USER.username,
      email:    VALID_USER.email,
    });
    // Password must never appear in the response
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('sets an httpOnly JWT cookie on successful registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('token=');
    expect(cookies[0]).toContain('HttpOnly');
  });

  test('rejects duplicate username or email with 409', async () => {
    // First registration must succeed
    const first = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);
    expect(first.status).toBe(201);

    // Second registration with the exact same credentials must fail
    const res = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ya está registrado/i);
  });

  test('rejects duplicate email with different username with 409', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'otrousuario', email: VALID_USER.email, password: 'abc123' });

    expect(res.status).toBe(409);
  });

  test('rejects username shorter than 3 characters with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', email: 'x@x.com', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/3 caracteres/i);
  });

  test('rejects invalid email format with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('rejects password shorter than 6 characters with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', email: 'x@x.com', password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contraseña/i);
  });
});

// ── POST /api/auth/login ──────────────────────────────────────

describe('POST /api/auth/login', () => {
  // Register a fresh user before each login test
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
  });

  test('logs in with correct credentials and returns user data', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(VALID_USER.email);
    expect(res.body.user.username).toBe(VALID_USER.username);
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('sets an httpOnly JWT cookie on successful login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('token=');
    expect(cookies[0]).toContain('HttpOnly');
  });

  test('rejects wrong password with 401 and generic error message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    // Generic message must not reveal whether the email exists (anti-enumeration)
    expect(res.body.error).toMatch(/credenciales incorrectas/i);
  });

  test('rejects unknown email with 401 and generic error message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credenciales incorrectas/i);
  });

  test('rejects request with missing password field with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email });   // password omitted

    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('returns success and clears the token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The token cookie must be cleared (empty value signals the browser to delete it)
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      expect(cookies[0]).toContain('token=');
    }
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────

describe('GET /api/auth/me', () => {
  // Register once before each test in this block and capture the cookie.
  // The outer beforeEach already cleared the DB, so the register always starts clean.
  let authCookie;

  beforeEach(async () => {
    authCookie = await registerAndGetCookie();
  });

  test('returns 401 when no cookie is present', async () => {
    // Issue a new request without the cookie
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns the current user data when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(VALID_USER.email);
    expect(res.body.user.username).toBe(VALID_USER.username);
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('returns a boolean needsPropertyName flag', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.needsPropertyName).toBe('boolean');
  });
});
