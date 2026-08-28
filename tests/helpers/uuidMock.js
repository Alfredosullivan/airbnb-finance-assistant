// uuidMock.js — Reemplaza el paquete uuid (pure ESM) con una implementación CJS
// durante los tests. uuid v14 usa export syntax que Jest (CommonJS mode) no puede parsear.
// Esta implementación usa crypto.randomUUID() que está disponible desde Node 14.17.
// Ver: jest.config moduleNameMapper en package.json

'use strict';

module.exports = {
  v4: () => require('crypto').randomUUID(),
};
