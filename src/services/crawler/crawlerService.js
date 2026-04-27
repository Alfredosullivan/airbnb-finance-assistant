'use strict';

// crawlerService.js — Servicio principal del crawler de precios de Mérida
// Orquesta el scraping de múltiples fuentes y el análisis con Claude.
//
// Flujo de crawlMeridaRentals:
//   1. Para cada fuente (TARGETS): fetchPage → parser → acumular listings
//   2. Calcular estadísticas agregadas (avg, min, max)
//   3. Devolver resultado estructurado con listings, stats y errores

const { fetchPage }    = require('./httpClient');
const { parseListings: parseLamudiListings } = require('./parsers/lamudiParser');

// ── Fuentes configuradas ────────────────────────────────────────
// Array de targets: cada uno define la URL a scrapear y el parser a usar.
// ¿Por qué este diseño?
// Separa la lógica de "qué scrapear" (TARGETS) de "cómo procesar el resultado" (parsers).
// Agregar una fuente nueva (ej: Vivanuncios) requiere solo añadir un objeto aquí
// y crear su parser — el resto del código no cambia (Open/Closed de SOLID).
//
// ¿Por qué Lamudi y no Inmuebles24?
// Inmuebles24 usa Cloudflare con protección avanzada que devuelve HTTP 403
// a cualquier request sin navegador real. Lamudi responde sin bloqueo y además
// embebe todos sus listings en JSON-LD server-side, lo que hace el parsing
// más robusto que selectores CSS (ver lamudiParser.js para detalles).
const TARGETS = [
  {
    name:   'lamudi',
    url:    'https://www.lamudi.com.mx/yucatan/merida/casa/for-rent/',
    parser: parseLamudiListings,
  },
];

// ── Crawler principal ───────────────────────────────────────────

/**
 * crawlMeridaRentals — Scrapea precios de rentas en Mérida de todas las fuentes configuradas
 *
 * @returns {Promise<Object>} Resultado estructurado con listings, stats, errores y metadatos
 */
const crawlMeridaRentals = async () => {
  const results = {
    crawledAt: new Date().toISOString(),
    sources:   [],
    listings:  [],
    errors:    [],
    stats:     {},
  };

  // Procesamos fuentes secuencialmente (no en paralelo) para respetar al servidor
  // ¿Por qué no Promise.all?
  // Con Promise.all, todos los requests irían al mismo tiempo — se comportaría
  // como un mini-DDoS y es probable que el servidor nos bloquee.
  // Secuencial + politeDelay() = comportamiento respetuoso.
  for (const target of TARGETS) {
    try {
      console.log(`[CRAWLER] Scrapeando ${target.name}...`);
      const html     = await fetchPage(target.url);
      const listings = target.parser(html);

      results.listings.push(...listings);
      results.sources.push({
        name:   target.name,
        url:    target.url,
        count:  listings.length,
        status: 'ok',
      });

      console.log(`[CRAWLER] ${target.name}: ${listings.length} propiedades encontradas`);
    } catch (err) {
      console.error(`[CRAWLER] Error en ${target.name}: ${err.message}`);
      results.errors.push({ source: target.name, error: err.message });
      results.sources.push({ name: target.name, status: 'error', error: err.message });
    }
  }

  // ── Calcular estadísticas agregadas ──────────────────────────
  // filter(Boolean) elimina nulls — precio puede ser null si extractPrice falló
  const prices = results.listings.map(l => l.price).filter(Boolean);

  results.stats = {
    total:        results.listings.length,
    avgPrice:     prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0,
    minPrice:     prices.length ? Math.min(...prices) : 0,
    maxPrice:     prices.length ? Math.max(...prices) : 0,
    sourcesOk:    results.sources.filter(s => s.status === 'ok').length,
    sourcesError: results.errors.length,
  };

  return results;
};

// ── Análisis con Claude ─────────────────────────────────────────

/**
 * analyzePricesWithClaude — Analiza los datos del crawl con Claude para sugerir tarifa óptima
 *
 * ¿Por qué el require de generatePriceAnalysis es dinámico (dentro de la función)?
 * Para evitar dependencia circular potencial: crawlerService → analysisGenerator → (ningún ciclo).
 * En este caso no hay ciclo, pero el require dinámico también permite que el módulo
 * se cargue sin que ANTHROPIC_API_KEY esté disponible — la validación ocurre solo
 * cuando se llama la función.
 *
 * @param {Object} crawlResults    - Resultado de crawlMeridaRentals()
 * @param {Object} propertyContext - Contexto de la propiedad del usuario (opcional)
 * @param {string} [propertyContext.name]        - Nombre de la propiedad
 * @param {number} [propertyContext.currentRate] - Tarifa actual por noche
 * @returns {Promise<string>} Análisis en texto generado por Claude
 */
const analyzePricesWithClaude = async (crawlResults, propertyContext = {}) => {
  // Require dinámico — carga en tiempo de ejecución, no al importar el módulo
  const { generatePriceAnalysis } = require('../analysisGenerator');

  const listings = crawlResults.listings.slice(0, 10)
    .map(l => `- ${l.title}: $${l.price} MXN (${l.location})`)
    .join('\n');

  const prompt = `
Eres un experto en rentas vacacionales de Mérida, Yucatán con conocimiento profundo del mercado local.

DATOS DEL MERCADO (scrapeados de portales de renta a largo plazo):
- Fecha: ${crawlResults.crawledAt}
- Propiedades analizadas: ${crawlResults.stats.total}
- Precio promedio mensual: $${crawlResults.stats.avgPrice} MXN/mes
- Rango: $${crawlResults.stats.minPrice} - $${crawlResults.stats.maxPrice} MXN/mes

IMPORTANTE: Estos precios son rentas mensuales de arrendamiento tradicional (no Airbnb). El usuario opera en renta vacacional por noche. Usa estos datos solo como referencia del valor del inmueble en el mercado local.

Muestra de propiedades del mercado:
${listings}

Responde en español con estas 3 secciones exactas:

## 1. Posicionamiento actual del mercado
Analiza la segmentación del mercado de rentas en Mérida. ¿Qué zonas dominan cada segmento? ¿Cómo está distribuida la oferta?

## 2. Tarifa competitiva por noche para Airbnb
Convierte los precios mensuales del mercado a tarifas nocturnas competitivas para Airbnb. Usa el estándar: renta mensual / (días disponibles × tasa de ocupación esperada). Da rangos concretos por segmento (económico, medio, premium).

## 3. Factores clave para el propietario
Menciona estacionalidad de Mérida, zonas de mayor demanda turística, amenidades que justifican precio premium, y una recomendación de tarifa base concreta.

Sé directo y práctico. Evita repetir los datos crudos — interprétalos.
`;

  return generatePriceAnalysis(prompt);
};

module.exports = { crawlMeridaRentals, analyzePricesWithClaude };
