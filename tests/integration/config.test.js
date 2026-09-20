// tests/integration/config.test.js — Pruebas de integración del endpoint de config pública.
// Verifica que GET /api/config refleje la presencia de ANTHROPIC_API_KEY sin exponer su valor.
// Usa el app espejo de testApp.js (mismo patrón que auth/properties), no index.js.

'use strict';

const request = require('supertest');

describe('GET /api/config', () => {
  let app;
  // Guardamos el valor original para restaurarlo tras cada test y no afectar a otros.
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    // testApp exporta una Promise que resuelve al app una vez lista la DB.
    app = await require('../helpers/testApp');
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('devuelve aiEnabled: true cuando la key está configurada', async () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
    // Act
    const res = await request(app).get('/api/config');
    // Assert
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(true);
  });

  it('devuelve aiEnabled: false cuando la key NO está configurada', async () => {
    // Arrange
    delete process.env.ANTHROPIC_API_KEY;
    // Act
    const res = await request(app).get('/api/config');
    // Assert
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(false);
  });

  it('nunca expone el valor de la API key', async () => {
    // Arrange
    process.env.ANTHROPIC_API_KEY = 'sk-super-secreta';
    // Act
    const res = await request(app).get('/api/config');
    // Assert
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secreta');
  });
});
