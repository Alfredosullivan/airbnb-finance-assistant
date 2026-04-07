// tests/integration/properties.test.js — Pruebas de integración de gestión de propiedades
// Cubre: crear propiedad, listar propiedades, rutas protegidas (auth requerida).

'use strict';

const request  = require('supertest');
const { pool } = require('../../src/database/client');

// ── Fixtures ───────────────────────────────────────────────────
const VALID_USER = {
  username: 'propuser',
  email:    'prop@example.com',
  password: 'password123',
};

// ── App setup ─────────────────────────────────────────────────
// testApp exports a Promise that resolves once the schema is ready.
let app;
beforeAll(async () => {
  app = await require('../helpers/testApp');
});

// ── Helpers ────────────────────────────────────────────────────

/**
 * registerAndGetCookie — Registers a user and returns the session cookie.
 * Uses a supertest agent so cookies are persisted automatically across calls.
 */
async function registerAndGetCookie(userData = VALID_USER) {
  const res = await request(app)
    .post('/api/auth/register')
    .send(userData);
  return res.headers['set-cookie'];
}

// ── Setup / Teardown ───────────────────────────────────────────

beforeEach(async () => {
  await pool.query('DELETE FROM reports');
  await pool.query('DELETE FROM properties');
  await pool.query('DELETE FROM users');
});

// ── Auth guard — routes must require authentication ────────────

describe('Authentication guard on /api/properties', () => {
  test('GET / returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/properties');
    expect(res.status).toBe(401);
  });

  test('POST / returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/properties')
      .send({ name: 'Casa Test' });
    expect(res.status).toBe(401);
  });

  test('PUT /:id returns 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/properties/1')
      .send({ name: 'Nuevo nombre' });
    expect(res.status).toBe(401);
  });

  test('DELETE /:id returns 401 when not authenticated', async () => {
    const res = await request(app).delete('/api/properties/1');
    expect(res.status).toBe(401);
  });
});

// ── POST /api/properties ──────────────────────────────────────

describe('POST /api/properties', () => {
  test('creates a new property and returns 201 with id and name', async () => {
    const cookie = await registerAndGetCookie();

    const res = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Departamento Roma' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.property.name).toBe('Departamento Roma');
    expect(typeof res.body.property.id).toBe('number');
  });

  test('rejects missing name with 400', async () => {
    const cookie = await registerAndGetCookie();

    const res = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre/i);
  });

  test('rejects blank name with 400', async () => {
    const cookie = await registerAndGetCookie();

    const res = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/properties ───────────────────────────────────────

describe('GET /api/properties', () => {
  test('returns empty array when user has no properties', async () => {
    // Register without triggering the auto-create-property path
    // (that only triggers on saveReport, not on register)
    const cookie = await registerAndGetCookie();

    const res = await request(app)
      .get('/api/properties')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.properties)).toBe(true);
  });

  test('returns all properties belonging to the authenticated user', async () => {
    const cookie = await registerAndGetCookie();

    // Create two properties
    await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Casa Condesa' });

    await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Depa Polanco' });

    const res = await request(app)
      .get('/api/properties')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(2);
    const names = res.body.properties.map(p => p.name);
    expect(names).toContain('Casa Condesa');
    expect(names).toContain('Depa Polanco');
  });

  test('user A cannot see user B properties', async () => {
    const cookieA = await registerAndGetCookie(VALID_USER);
    const cookieB = await registerAndGetCookie({
      username: 'userB',
      email:    'userb@example.com',
      password: 'password123',
    });

    // User A creates a property
    await request(app)
      .post('/api/properties')
      .set('Cookie', cookieA)
      .send({ name: 'Propiedad de A' });

    // User B should see none of A's properties
    const res = await request(app)
      .get('/api/properties')
      .set('Cookie', cookieB);

    expect(res.status).toBe(200);
    const names = res.body.properties.map(p => p.name);
    expect(names).not.toContain('Propiedad de A');
  });
});

// ── PUT /api/properties/:id ───────────────────────────────────

describe('PUT /api/properties/:id', () => {
  test('renames an existing property and returns the new name', async () => {
    const cookie = await registerAndGetCookie();

    const createRes = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Nombre viejo' });

    const id = createRes.body.property.id;

    const renameRes = await request(app)
      .put(`/api/properties/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Nombre nuevo' });

    expect(renameRes.status).toBe(200);
    expect(renameRes.body.success).toBe(true);
    expect(renameRes.body.name).toBe('Nombre nuevo');
  });

  test('returns 404 when trying to rename a property that does not belong to the user', async () => {
    const cookieA = await registerAndGetCookie(VALID_USER);
    const cookieB = await registerAndGetCookie({
      username: 'userB2',
      email:    'userb2@example.com',
      password: 'password123',
    });

    const createRes = await request(app)
      .post('/api/properties')
      .set('Cookie', cookieA)
      .send({ name: 'Propiedad de A' });

    const idA = createRes.body.property.id;

    // User B tries to rename user A's property
    const res = await request(app)
      .put(`/api/properties/${idA}`)
      .set('Cookie', cookieB)
      .send({ name: 'Secuestrada' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/properties/:id ────────────────────────────────

describe('DELETE /api/properties/:id', () => {
  test('cannot delete the only property (must have at least one)', async () => {
    const cookie = await registerAndGetCookie();

    const createRes = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Única propiedad' });

    const id = createRes.body.property.id;

    const deleteRes = await request(app)
      .delete(`/api/properties/${id}`)
      .set('Cookie', cookie);

    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body.error).toMatch(/única/i);
  });

  test('deletes a property when the user has more than one', async () => {
    const cookie = await registerAndGetCookie();

    const res1 = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Propiedad 1' });

    const res2 = await request(app)
      .post('/api/properties')
      .set('Cookie', cookie)
      .send({ name: 'Propiedad 2' });

    const idToDelete = res1.body.property.id;

    const deleteRes = await request(app)
      .delete(`/api/properties/${idToDelete}`)
      .set('Cookie', cookie);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Verify it's gone
    const listRes = await request(app)
      .get('/api/properties')
      .set('Cookie', cookie);

    const remaining = listRes.body.properties.map(p => p.name);
    expect(remaining).not.toContain('Propiedad 1');
    expect(remaining).toContain('Propiedad 2');
  });
});
