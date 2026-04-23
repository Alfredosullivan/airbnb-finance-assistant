'use strict';

// inmuebles24Parser.js — Parser para la página de resultados de Inmuebles24
// URL objetivo: https://www.inmuebles24.com/propiedades-en-renta-en-merida-yucatan.html
//
// ⚠️  NOTA IMPORTANTE SOBRE SELECTORES:
// Los selectores CSS de sitios externos pueden cambiar sin previo aviso cuando
// el sitio actualiza su HTML. Si este parser devuelve count: 0, probablemente
// los selectores necesitan revisión contra el HTML actual del sitio.
// Proceso de depuración: fetchPage(url) → guardar el HTML → inspeccionar selectores en browser.

const cheerio = require('cheerio');

// ── Helper de extracción de precio ─────────────────────────────

/**
 * extractPrice — Extrae el valor numérico de un texto de precio
 *
 * Ejemplos de input → output:
 *   "$15,000 /mes"  → 15000
 *   "MXN 8,500"     → 8500
 *   "$1,200,000"    → 1200000
 *   "Consultar"     → null
 *
 * @param {string} text - Texto del precio con símbolo y separadores
 * @returns {number|null}
 */
const extractPrice = (text) => {
  if (!text) return null;

  // Eliminar: $ , espacios, y todo lo que venga después del primer /
  // ¿Por qué /\/.*/? Remueve "/mes", "/noche", etc. — solo queremos el número
  const cleaned = text.replace(/[,$\s]/g, '').replace(/\/.*/, '');

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
};

// ── Parser principal ────────────────────────────────────────────

/**
 * parseListings — Parsea el HTML de resultados de Inmuebles24 y extrae listings
 *
 * Usa cheerio (jQuery-like para Node) para seleccionar elementos del DOM.
 * ¿Por qué cheerio y no regex?
 * El HTML moderno es complejo y anidado. Regex falla con tags anidados.
 * Cheerio carga el HTML en un árbol DOM y permite selectores CSS confiables.
 *
 * @param {string} html - HTML crudo de la página de resultados
 * @returns {Array<Object>} Array de listings extraídos
 */
const parseListings = (html) => {
  const $ = cheerio.load(html);
  const listings = [];

  // Selector principal: tarjetas de propiedad en Inmuebles24
  // data-qa="posting PROPERTY" es el atributo semántico de cada tarjeta
  // Más estable que clases CSS (que cambian frecuentemente con rediseños)
  $('[data-qa="posting PROPERTY"]').each((i, el) => {
    try {
      const card = $(el);

      // ── Precio ────────────────────────────────────────────────
      const priceText = card.find('[data-qa="POSTING_CARD_PRICE"]').text().trim();
      const price     = extractPrice(priceText);

      // ── Título / descripción del listing ──────────────────────
      // Intenta el selector semántico primero; fallback al primer h2
      const title = card.find('[data-qa="posting-card-title"]').text().trim()
        || card.find('h2').first().text().trim();

      // ── Ubicación ─────────────────────────────────────────────
      const location = card.find('[data-qa="POSTING_CARD_LOCATION"]').text().trim();

      // ── Características (recámaras, baños, m²) ────────────────
      const features = card.find('[data-qa="POSTING_CARD_FEATURES"]').text().trim();

      // ── URL del listing ────────────────────────────────────────
      // Algunos hrefs son relativos (/departamento-en-...) — completamos con el dominio
      const href = card.find('a').first().attr('href') || '';
      const url  = href.startsWith('http')
        ? href
        : `https://www.inmuebles24.com${href}`;

      // Solo agregamos listings con precio válido — descartamos "Consultar", vacíos, etc.
      if (price && price > 0) {
        listings.push({
          source:    'inmuebles24',
          title:     title    || 'Sin título',
          price,
          priceText,
          location:  location || 'Mérida, Yucatán',
          features:  features || '',
          url,
          scrapedAt: new Date().toISOString(),
        });
      }
    } catch (_) {
      // Skip listings individuales con error de parsing — el resto sigue procesándose.
      // Un solo listing mal formado no debe detener la extracción de los demás.
    }
  });

  return listings;
};

module.exports = { parseListings, extractPrice };
