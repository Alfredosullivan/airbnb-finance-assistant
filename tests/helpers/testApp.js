// tests/helpers/testApp.js — Express app for integration tests
// Mirrors the same middleware/routes as index.js but does NOT call app.listen.
// Uses pg-mem (in-memory PostgreSQL) configured by NODE_ENV=test in setup.js.
//
// IMPORTANT — async initialization:
// initSchema() is async (PostgreSQL), so this module exports a Promise that
// resolves to the configured Express app once the tables are ready.
//
// Usage in test files:
//   let app;
//   beforeAll(async () => { app = await require('../helpers/testApp'); });

'use strict';

const { initSchema } = require('../../src/database/schema');
const express          = require('express');
const cookieParser     = require('cookie-parser');
const authRoutes       = require('../../src/routes/auth.routes');
const propertiesRoutes = require('../../src/routes/properties.routes');
const { errorHandler } = require('../../src/middleware/errorHandler');

const app = express();

app.use(cookieParser());
app.use(express.json());

app.use('/api/auth',       authRoutes);
app.use('/api/properties', propertiesRoutes);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Centralized error handler — must be last
app.use(errorHandler);

// Export a Promise — tests await this to ensure tables exist before any request
module.exports = initSchema().then(() => app);
