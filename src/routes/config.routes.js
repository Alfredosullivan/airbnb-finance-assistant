'use strict';

// config.routes.js — Ruta de configuración pública. Montada bajo /api/config.
// Sin requireAuth: el frontend la consulta al arrancar, antes del login.

const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../controllers/config.controller');

// GET /api/config — Feature flags públicas (ej: { aiEnabled: true })
// Es GET '/' porque el prefijo '/api/config' ya se define al montar en index.js.
router.get('/', getPublicConfig);

module.exports = router;
