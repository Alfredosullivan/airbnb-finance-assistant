'use strict';

// config.controller.js — Expone la configuración pública de features al frontend.
// No devuelve secretos: solo BANDERAS booleanas de qué está disponible.

/**
 * getPublicConfig — Devuelve las feature flags que el frontend necesita para
 * decidir qué UI mostrar. Público (sin auth) porque no expone datos sensibles.
 * GET /api/config
 */
function getPublicConfig(_req, res) {
  res.json({
    // La doble negación (!!) convierte el string de la env var (o undefined) en booleano.
    // Nunca devolvemos la key en sí — solo si existe o no.
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
  });
}

module.exports = { getPublicConfig };
