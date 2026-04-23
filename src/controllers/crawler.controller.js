'use strict';

// crawler.controller.js — Controlador para el crawler de precios de rentas en Mérida
// Expone dos endpoints:
//   GET  /api/crawler/listings — scrapea y devuelve listings de forma síncrona
//   POST /api/crawler/analyze  — encola un análisis de mercado con Claude (operación lenta)

const { crawlMeridaRentals, analyzePricesWithClaude } = require('../services/crawler/crawlerService');
const queue = require('../queue/MemoryQueue');

/**
 * getListings — Ejecuta el crawl de forma síncrona y devuelve los resultados
 * GET /api/crawler/listings
 *
 * ¿Por qué síncrono aquí y no encolado?
 * El crawl solo tarda 3-6 segundos (politeDelay + una fuente).
 * Es lo suficientemente rápido para responder en el mismo request.
 * Si se agregaran más fuentes (5-10 sitios), habría que mover esto a la cola también.
 */
const getListings = async (req, res) => {
  try {
    const results = await crawlMeridaRentals();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * analyzeMarket — Encola un análisis de mercado con Claude
 * POST /api/crawler/analyze
 *
 * ¿Por qué usar la cola aquí?
 * El análisis de mercado tiene dos operaciones lentas en serie:
 *   1. crawlMeridaRentals() → 3-6 segundos
 *   2. generatePriceAnalysis() → 5-15 segundos con Claude API
 * Total estimado: 8-21 segundos — demasiado para un HTTP request sincrono.
 * Encolar y usar polling es la respuesta correcta (igual que Excel generation).
 *
 * Body esperado: { propertyName?: string, currentRate?: number }
 */
const analyzeMarket = async (req, res) => {
  try {
    const { propertyName, currentRate } = req.body || {};

    // Encolar el job de análisis de mercado
    // El worker procesará: crawl → Claude → resultado como texto descargable
    const job = queue.addJob('market_analysis', {
      userId:       req.user.userId,
      propertyName: propertyName || null,
      currentRate:  currentRate  || null,
    });

    // 202 Accepted — request aceptado pero procesamiento no terminó aún
    res.status(202).json({
      jobId:   job.id,
      status:  job.status,
      message: `Análisis de mercado encolado. Consulta el estado en GET /api/jobs/${job.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getListings, analyzeMarket };
