// src/config/swagger.js — OpenAPI 3.0 specification for swagger-jsdoc
// Loaded once at startup; route JSDoc @swagger blocks are merged in automatically.

'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Airbnb Finance Assistant API',
      version:     '1.0.0',
      description: [
        'REST API for reconciling Airbnb payouts against BBVA bank statements.',
        'Parses Airbnb CSV/PDF exports and bank PDFs, cross-matches transactions',
        'by amount and date, generates Excel/PDF reports, and stores monthly',
        'history per user and property.',
      ].join(' '),
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development server' },
    ],
    components: {
      securitySchemes: {
        // JWT is stored as an httpOnly cookie named "token"
        cookieAuth: {
          type: 'apiKey',
          in:   'cookie',
          name: 'token',
        },
      },
      schemas: {
        // ── Reusable inline schemas ──────────────────────────────
        User: {
          type: 'object',
          properties: {
            id:         { type: 'integer', example: 1 },
            username:   { type: 'string',  example: 'johndoe' },
            email:      { type: 'string',  format: 'email', example: 'john@example.com' },
            created_at: { type: 'string',  format: 'date-time' },
          },
        },
        Property: {
          type: 'object',
          properties: {
            id:         { type: 'integer', example: 42 },
            name:       { type: 'string',  example: 'Departamento Roma' },
            created_at: { type: 'string',  format: 'date-time' },
          },
        },
        ReportMeta: {
          type: 'object',
          properties: {
            month:  { type: 'string', example: '2026-02' },
            label:  { type: 'string', example: 'Febrero 2026' },
            year:   { type: 'integer', example: 2026 },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Credenciales incorrectas' },
          },
        },
      },
    },
  },
  // Glob pattern resolved relative to process.cwd() (project root)
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
