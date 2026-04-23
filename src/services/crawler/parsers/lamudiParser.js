'use strict';

// lamudiParser.js — Parser para la página de resultados de Lamudi
// URL objetivo: https://www.lamudi.com.mx/yucatan/merida/casa/for-rent/
//
// ── Por qué JSON-LD y no selectores CSS ──────────────────────────────────────
// Lamudi usa client-side rendering: el HTML estático llega con el contenedor
// de listings vacío (.listings__cards existe pero tiene 0 hijos). El JavaScript
// del browser los inyecta después — y nosotros no ejecutamos JavaScript.
//
// Lamudi sí genera en el servidor un bloque JSON-LD (<script type="application/ld+json">)
// con los 30 listings completos en formato schema.org. Esto es más estable que
// selectores CSS porque:
//   1. Google requiere que JSON-LD esté presente en el HTML sin JavaScript
//   2. La estructura de schema.org cambia menos frecuentemente que las clases CSS
//   3. Los datos son estructurados — no hay ambigüedad sobre qué campo es qué
//
// ── Ruta de navegación en el JSON ────────────────────────────────────────────
// data[0]["@graph"][0]        → SearchResultsPage
//   .mainEntity["0"]          → ItemList (30 propiedades principales)
//     .itemListElement[n]     → ListItem
//       .item                 → SingleFamilyResidence (el listing)
//
// ── Nota sobre el precio ─────────────────────────────────────────────────────
// Los listings de Lamudi NO tienen un campo dedicado de precio en el schema.
// El precio aparece como texto libre dentro de item.description (ej: "💰 Precio: $35,000").
// La función extractPriceFromDescription usa regex para recuperarlo.
// Tasa de éxito real: ~13/30 listings tienen precio extraíble.
// Los demás simplemente no mencionan el precio en la descripción.

// ── Constantes ───────────────────────────────────────────────────────────────

// Precio máximo aceptable en MXN para una renta mensual.
// Los listings con precios mayores son probablemente propiedades en VENTA
// que aparecen mezcladas en los resultados. $200,000/mes es el techo realista
// para rentas en Mérida.
const MAX_RENTAL_PRICE_MXN = 200_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * extractPriceFromDescription — Extrae el precio mensual del texto de la descripción
 *
 * Patrones que maneja (en orden de especificidad, de más a menos):
 *   "💰 Precio de renta: $35,000.00"  → 35000
 *   "precio: $14,500"                  → 14500
 *   "renta: $12,500"                   → 12500
 *   "$35,000"                          → 35000 (fallback genérico)
 *   "35,000 MXN"                       → 35000
 *
 * ¿Por qué orden de especificidad?
 * En una descripción puede aparecer tanto "precio: $X" como "$Y" suelto.
 * Los patrones más específicos (con contexto antes del $) evitan capturar
 * precios de otro tipo mencionados en el cuerpo (ej: "a 10 minutos del
 * centro comercial a $200 el m2").
 *
 * @param {string} description - Texto completo de la descripción
 * @returns {number|null} Precio como número o null si no se encontró
 */
const extractPriceFromDescription = (description) => {
  if (!description) return null;

  // Patrones ordenados de mayor a menor especificidad
  const patterns = [
    // 💰 Precio de renta: $35,000.00
    /💰[^$]*\$\s*([\d,]+(?:\.\d{2})?)/,
    // precio: $14,500 (con o sin dos puntos)
    /precio[^$\n]{0,20}\$\s*([\d,]+(?:\.\d{2})?)/i,
    // renta: $12,500
    /renta[^$\n]{0,20}\$\s*([\d,]+(?:\.\d{2})?)/i,
    // $35,000 genérico — captura el PRIMER $ de la descripción
    /\$\s*([\d,]+(?:\.\d{2})?)/,
    // 35,000 MXN
    /([\d,]+(?:\.\d{2})?)\s*(?:MXN|pesos)/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      // Eliminar comas de separador de miles antes de parsear
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) return num;
    }
  }

  return null;
};

/**
 * buildLocation — Construye una cadena de ubicación legible desde el objeto address
 *
 * @param {Object} address - Objeto PostalAddress de schema.org
 * @returns {string}
 */
const buildLocation = (address) => {
  if (!address) return 'Mérida, Yucatán';

  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
  ].filter(Boolean);

  // Devolver las partes disponibles separadas por coma
  // Si no hay nada, fallback al valor por defecto
  return parts.length > 0 ? parts.join(', ') : 'Mérida, Yucatán';
};

// ── Parser principal ──────────────────────────────────────────────────────────

/**
 * parseListings — Extrae listings del bloque JSON-LD de Lamudi
 *
 * ¿Por qué parsear JSON y no usar cheerio?
 * Ver comentario al inicio del archivo. TL;DR: el DOM llega vacío, el JSON-LD no.
 *
 * @param {string} html - HTML crudo de la página de resultados de Lamudi
 * @returns {Array<Object>} Array de listings normalizados
 */
const parseListings = (html) => {
  // ── Paso 1: Extraer el bloque JSON-LD ─────────────────────────────────────
  // Lamudi tiene exactamente 1 bloque ld+json por página
  const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!scriptMatch) {
    // Si no hay JSON-LD, la página cambió estructura — devolvemos vacío en vez de lanzar
    console.warn('[lamudiParser] No se encontró bloque JSON-LD en el HTML');
    return [];
  }

  // ── Paso 2: Parsear el JSON ───────────────────────────────────────────────
  let data;
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch (err) {
    console.warn('[lamudiParser] Error al parsear JSON-LD:', err.message);
    return [];
  }

  // ── Paso 3: Navegar hasta los ItemListElement ─────────────────────────────
  // La estructura puede variar ligeramente — usamos optional chaining en cada paso
  // para evitar crashes si Lamudi cambia el schema.
  const graph     = data[0]?.['@graph']?.[0];
  const mainEntity = graph?.mainEntity;
  // mainEntity es un objeto con claves '0', '1', '2'
  // '0' = 30 propiedades principales (la página de resultados)
  // '1' = 15 propiedades similares o anuncios relacionados (duplicados parciales)
  // '2' = FAQPage (sin listings)
  // Usamos solo '0' para evitar duplicados
  const primaryList = mainEntity?.['0'];
  const itemListElements = primaryList?.itemListElement;

  if (!Array.isArray(itemListElements) || itemListElements.length === 0) {
    console.warn('[lamudiParser] No se encontraron itemListElement en el JSON-LD');
    return [];
  }

  // ── Paso 4: Mapear cada ListItem a nuestro formato normalizado ─────────────
  const listings = [];

  for (const listItem of itemListElements) {
    try {
      const item = listItem?.item;
      if (!item) continue;

      // Extraer precio del texto de la descripción
      const price = extractPriceFromDescription(item.description);

      // Filtrar listings sin precio válido o con precio que parece precio de venta
      // ¿Por qué filtrar > MAX_RENTAL_PRICE_MXN?
      // Algunos listings de VENTA aparecen en páginas de renta. Sus precios
      // (ej: $3,690,000) son detectables porque son órdenes de magnitud mayores
      // que cualquier renta mensual en Mérida.
      if (!price || price > MAX_RENTAL_PRICE_MXN) continue;

      listings.push({
        source:   'lamudi',
        title:    item.name   || 'Sin título',
        price,
        // Texto original para debug / trazabilidad
        priceText: `$${price.toLocaleString('es-MX')}`,
        location: buildLocation(item.address),
        features: [
          item.numberOfBedrooms        ? `${item.numberOfBedrooms} rec`          : null,
          item.numberOfBathroomsTotal  ? `${item.numberOfBathroomsTotal} baños`  : null,
          item.floorSize?.value        ? `${item.floorSize.value} m²`            : null,
        ].filter(Boolean).join(' · '),
        url:       item.url || item['@id'] || '',
        scrapedAt: new Date().toISOString(),
      });

    } catch (_) {
      // Un listing con error de estructura no debe detener el procesamiento del resto.
      // Patrón de resiliencia: cualquier error individual es silenciado.
    }
  }

  return listings;
};

module.exports = { parseListings, extractPriceFromDescription };
