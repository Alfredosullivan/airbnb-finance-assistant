// ReportRepository.js — Acceso a datos del modelo Report (PostgreSQL)
// Encapsula todas las consultas SQL sobre la tabla `reports`.
// Los controladores NUNCA deben importar `pool` directamente para reportes.

'use strict';

const { pool } = require('../database/client');

// ── Funciones de escritura ─────────────────────────────────────

/**
 * upsert — Inserta o actualiza un reporte para (userId, propertyId, monthKey).
 * Si ya existe el triplete (UNIQUE), sobreescribe año, label, summary y created_at.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} monthKey   - Formato YYYY-MM
 * @param {number} year
 * @param {string} label      - Etiqueta legible del mes (ej: "Febrero 2026")
 * @param {string} summaryJson - JSON.stringify del reporte completo
 * @returns {Promise<void>}
 */
async function upsert(userId, propertyId, monthKey, year, label, summaryJson) {
  await pool.query(`
    INSERT INTO reports (user_id, property_id, month, year, label, summary)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, property_id, month) DO UPDATE SET
      year       = EXCLUDED.year,
      label      = EXCLUDED.label,
      summary    = EXCLUDED.summary,
      created_at = NOW()
  `, [userId, propertyId, monthKey, year, label, summaryJson]);
}

/**
 * updateSummary — Actualiza el campo summary de un reporte existente.
 *
 * @param {number} id          - PK del reporte
 * @param {string} summaryJson
 * @param {boolean} [touchTimestamp=false] - Si true, actualiza created_at
 * @returns {Promise<void>}
 */
async function updateSummary(id, summaryJson, touchTimestamp = false) {
  if (touchTimestamp) {
    await pool.query(
      'UPDATE reports SET summary = $1, created_at = NOW() WHERE id = $2',
      [summaryJson, id]
    );
  } else {
    await pool.query(
      'UPDATE reports SET summary = $1 WHERE id = $2',
      [summaryJson, id]
    );
  }
}

/**
 * remove — Elimina el reporte de (userId, propertyId, month).
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} month
 * @returns {Promise<number>} filas eliminadas (0 si no existía)
 */
async function remove(userId, propertyId, month) {
  const { rowCount } = await pool.query(
    'DELETE FROM reports WHERE user_id = $1 AND property_id = $2 AND month = $3',
    [userId, propertyId, month]
  );
  return rowCount;
}

/**
 * removeAny — Elimina el reporte de (userId, month) sin filtrar por propiedad.
 *
 * @param {number} userId
 * @param {string} month
 * @returns {Promise<number>} filas eliminadas
 */
async function removeAny(userId, month) {
  const { rowCount } = await pool.query(
    'DELETE FROM reports WHERE user_id = $1 AND month = $2',
    [userId, month]
  );
  return rowCount;
}

// ── Funciones de lectura ──────────────────────────────────────

/**
 * countByProperty — Total de reportes asociados a una propiedad.
 *
 * @param {number} propertyId
 * @returns {Promise<number>}
 */
async function countByProperty(propertyId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS reportes FROM reports WHERE property_id = $1',
    [propertyId]
  );
  return parseInt(rows[0].reportes, 10);
}

/**
 * listByProperty — Lista de reportes de una propiedad específica.
 * Ordenada por año DESC, mes ASC (dentro del mismo año).
 *
 * @param {number} userId
 * @param {number} propertyId
 * @returns {Promise<Array<{ id, month, year, label, created_at, summary }>>}
 */
async function listByProperty(userId, propertyId) {
  const { rows } = await pool.query(`
    SELECT id, month, year, label, created_at, summary
    FROM   reports
    WHERE  user_id = $1 AND property_id = $2
    ORDER  BY SUBSTR(month, 1, 4) DESC, month ASC
  `, [userId, propertyId]);
  return rows;
}

/**
 * listByUser — Lista todos los reportes del usuario (sin filtro de propiedad).
 *
 * @param {number} userId
 * @returns {Promise<Array<{ id, month, year, label, created_at, summary }>>}
 */
async function listByUser(userId) {
  const { rows } = await pool.query(`
    SELECT id, month, year, label, created_at, summary
    FROM   reports
    WHERE  user_id = $1
    ORDER  BY SUBSTR(month, 1, 4) DESC, month ASC
  `, [userId]);
  return rows;
}

/**
 * findByMonth — Busca un reporte por (userId, propertyId, month).
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} month
 * @returns {Promise<{ id, summary } | null>}
 */
async function findByMonth(userId, propertyId, month) {
  const { rows } = await pool.query(
    'SELECT id, summary FROM reports WHERE user_id = $1 AND property_id = $2 AND month = $3',
    [userId, propertyId, month]
  );
  return rows[0] || null;
}

/**
 * findByMonthAny — Busca el reporte más reciente de (userId, month) sin filtro de propiedad.
 *
 * @param {number} userId
 * @param {string} month
 * @returns {Promise<{ id, summary } | null>}
 */
async function findByMonthAny(userId, month) {
  const { rows } = await pool.query(
    'SELECT id, summary FROM reports WHERE user_id = $1 AND month = $2 ORDER BY id DESC LIMIT 1',
    [userId, month]
  );
  return rows[0] || null;
}

/**
 * findSummaryByMonth — Como findByMonth pero devuelve solo el campo summary.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} month
 * @returns {Promise<{ summary: string } | null>}
 */
async function findSummaryByMonth(userId, propertyId, month) {
  const { rows } = await pool.query(
    'SELECT summary FROM reports WHERE user_id = $1 AND property_id = $2 AND month = $3',
    [userId, propertyId, month]
  );
  return rows[0] || null;
}

/**
 * findSummaryByMonthAny — Como findByMonthAny pero devuelve solo el summary.
 *
 * @param {number} userId
 * @param {string} month
 * @returns {Promise<{ summary: string } | null>}
 */
async function findSummaryByMonthAny(userId, month) {
  const { rows } = await pool.query(
    'SELECT summary FROM reports WHERE user_id = $1 AND month = $2 ORDER BY id DESC LIMIT 1',
    [userId, month]
  );
  return rows[0] || null;
}

/**
 * findByYear — Lista reportes de un año para una propiedad específica.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {number} year
 * @returns {Promise<Array<{ month, label, summary }>>}
 */
async function findByYear(userId, propertyId, year) {
  const { rows } = await pool.query(`
    SELECT month, label, summary
    FROM   reports
    WHERE  user_id = $1 AND property_id = $2 AND year = $3
    ORDER  BY month ASC
  `, [userId, propertyId, year]);
  return rows;
}

/**
 * findByYearAll — Lista reportes de un año para todas las propiedades del usuario.
 *
 * @param {number} userId
 * @param {number} year
 * @returns {Promise<Array<{ month, label, summary }>>}
 */
async function findByYearAll(userId, year) {
  const { rows } = await pool.query(`
    SELECT month, label, summary
    FROM   reports
    WHERE  user_id = $1 AND year = $2
    ORDER  BY month ASC
  `, [userId, year]);
  return rows;
}

/**
 * findSummaryByYear — Como findByYear pero devuelve solo month y summary.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {number} year
 * @returns {Promise<Array<{ month, summary }>>}
 */
async function findSummaryByYear(userId, propertyId, year) {
  const { rows } = await pool.query(`
    SELECT month, summary
    FROM   reports
    WHERE  user_id = $1 AND property_id = $2 AND year = $3
    ORDER  BY month ASC
  `, [userId, propertyId, year]);
  return rows;
}

/**
 * findSummaryByYearAll — Como findByYearAll pero devuelve solo month y summary.
 *
 * @param {number} userId
 * @param {number} year
 * @returns {Promise<Array<{ month, summary }>>}
 */
async function findSummaryByYearAll(userId, year) {
  const { rows } = await pool.query(`
    SELECT month, summary
    FROM   reports
    WHERE  user_id = $1 AND year = $2
    ORDER  BY month ASC
  `, [userId, year]);
  return rows;
}

/**
 * findByYearWithPropertyName — Reporte combinado: une reports con properties.
 *
 * @param {number} userId
 * @param {number} year
 * @returns {Promise<Array<{ month, label, summary, property_id, property_name }>>}
 */
async function findByYearWithPropertyName(userId, year) {
  const { rows } = await pool.query(`
    SELECT r.month, r.label, r.summary, r.property_id, p.name AS property_name
    FROM   reports r
    LEFT   JOIN properties p ON p.id = r.property_id
    WHERE  r.user_id = $1 AND r.year = $2
    ORDER  BY r.month ASC, r.property_id ASC
  `, [userId, year]);
  return rows;
}

/**
 * findByMonthLike — Busca reportes cuyo mes coincida con un patrón LIKE.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} pattern - Ej: '2026-%'
 * @returns {Promise<Array<{ month, summary }>>}
 */
async function findByMonthLike(userId, propertyId, pattern) {
  const { rows } = await pool.query(`
    SELECT month, summary
    FROM   reports
    WHERE  user_id = $1 AND property_id = $2 AND month LIKE $3
    ORDER  BY month ASC
  `, [userId, propertyId, pattern]);
  return rows;
}

/**
 * findNextYearEntry — Busca si existe un reporte para un mes concreto.
 *
 * @param {number} userId
 * @param {number} propertyId
 * @param {string} month
 * @returns {Promise<{ id, label } | null>}
 */
async function findNextYearEntry(userId, propertyId, month) {
  const { rows } = await pool.query(
    'SELECT id, label FROM reports WHERE user_id = $1 AND property_id = $2 AND month = $3',
    [userId, propertyId, month]
  );
  return rows[0] || null;
}

module.exports = {
  upsert,
  updateSummary,
  remove,
  removeAny,
  countByProperty,
  listByProperty,
  listByUser,
  findByMonth,
  findByMonthAny,
  findSummaryByMonth,
  findSummaryByMonthAny,
  findByYear,
  findByYearAll,
  findSummaryByYear,
  findSummaryByYearAll,
  findByYearWithPropertyName,
  findByMonthLike,
  findNextYearEntry,
};
