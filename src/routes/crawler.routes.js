'use strict';

// crawler.routes.js — Rutas del crawler de precios de rentas en Mérida
// Montadas bajo /api/crawler en index.js
// Ambas rutas requieren autenticación — los datos del mercado son para usuarios registrados

const express     = require('express');
const router      = express.Router();
const { requireAuth }               = require('../middleware/auth.middleware');
const { getListings, analyzeMarket } = require('../controllers/crawler.controller');

// GET  /api/crawler/listings — Scrapea y devuelve listings actuales del mercado
router.get('/listings', requireAuth, getListings);

// POST /api/crawler/analyze  — Encola análisis de mercado con Claude (responde 202)
// Body: { propertyName?: string, currentRate?: number }
router.post('/analyze', requireAuth, analyzeMarket);

module.exports = router;
