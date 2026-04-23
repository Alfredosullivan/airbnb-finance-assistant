'use strict';

// httpClient.js — Cliente HTTP reutilizable para el crawler
// Imita un browser real con headers apropiados para evitar bloqueos básicos.
// Todos los requests pasan por fetchPage para garantizar comportamiento consistente.

const fetch = require('node-fetch');

// Headers que imitan un browser real — evita bloqueos básicos de sitios
// ¿Por qué estos headers?
// Sin headers, el request llega como "Node.js fetch" y muchos sitios lo bloquean (403/429).
// Con headers de browser, el servidor ve un request aparentemente legítimo.
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control':   'no-cache',
  'Connection':      'keep-alive',
};

// ── Helpers de timing ──────────────────────────────────────────

/**
 * delay — Espera N milisegundos antes de continuar.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * politeDelay — Pausa aleatoria de 1.5 a 3 segundos entre requests.
 *
 * ¿Por qué aleatorio y no fijo?
 * Un intervalo fijo (ej: exactamente 2s) es fácil de detectar como bot.
 * El jitter aleatorio imita el comportamiento humano y reduce la probabilidad
 * de ser identificado como scraper. También reduce la carga en el servidor
 * objetivo — respeto básico al robot.txt aunque el sitio no lo requiera.
 */
const politeDelay = () => delay(1500 + Math.random() * 1500); // 1.5s a 3s

// ── Función principal ──────────────────────────────────────────

/**
 * fetchPage — Descarga el HTML de una URL con headers de browser.
 *
 * @param {string} url                - URL a descargar
 * @param {Object} [options={}]       - Opciones extra para fetch (headers adicionales, etc.)
 * @returns {Promise<string>}         - HTML de la página como string
 * @throws {Error}                    - Si la respuesta HTTP no es 2xx
 */
const fetchPage = async (url, options = {}) => {
  // Pausa antes de cada request — no bombardear el servidor
  await politeDelay();

  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...options.headers },
    // Timeout de 15s — si el servidor no responde en 15s, abortamos
    // node-fetch v2 acepta 'timeout' directamente (en v3 hay que usar AbortController)
    timeout: 15000,
    ...options,
  });

  // Verificar que la respuesta fue exitosa (2xx)
  // ¿Por qué lanzar error aquí y no dejar que el parser maneje HTML de error?
  // Porque páginas 403/404/5xx devuelven HTML de error que los parsers no pueden procesar.
  // Es mejor fallar rápido con un mensaje claro que parsear silenciosamente HTML vacío.
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} para ${url}`);
  }

  return res.text();
};

module.exports = { fetchPage, delay, politeDelay };
