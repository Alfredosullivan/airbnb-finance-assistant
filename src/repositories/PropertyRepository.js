// PropertyRepository.js — Acceso a datos del modelo Property (PostgreSQL)
// Encapsula todas las consultas SQL sobre la tabla `properties`.
// Los controladores NUNCA deben importar `pool` directamente para propiedades.

'use strict';

const { pool } = require('../database/client');

// ── Funciones de lectura ──────────────────────────────────────

/**
 * findByIdAndUser — Verifica que la propiedad exista y pertenezca al usuario.
 *
 * @param {number} id
 * @param {number} userId
 * @returns {Promise<{ id, name } | null>}
 */
async function findByIdAndUser(id, userId) {
  const { rows } = await pool.query(
    'SELECT id, name FROM properties WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

/**
 * findNameByIdAndUser — Devuelve solo el nombre de la propiedad.
 *
 * @param {number} id
 * @param {number} userId
 * @returns {Promise<{ name: string } | null>}
 */
async function findNameByIdAndUser(id, userId) {
  const { rows } = await pool.query(
    'SELECT name FROM properties WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rows[0] || null;
}

/**
 * findAllByUser — Lista todas las propiedades del usuario (id + name + created_at).
 *
 * @param {number} userId
 * @returns {Promise<Array<{ id, name, created_at }>>}
 */
async function findAllByUser(userId) {
  const { rows } = await pool.query(
    'SELECT id, name, created_at FROM properties WHERE user_id = $1 ORDER BY id ASC',
    [userId]
  );
  return rows;
}

/**
 * findAllByUserOrderedByCreation — Lista propiedades ordenadas por fecha de creación.
 *
 * @param {number} userId
 * @returns {Promise<Array<{ id, name }>>}
 */
async function findAllByUserOrderedByCreation(userId) {
  const { rows } = await pool.query(
    'SELECT id, name FROM properties WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return rows;
}

/**
 * findNamesByUser — Devuelve solo los nombres de las propiedades del usuario.
 *
 * @param {number} userId
 * @returns {Promise<string[]>}
 */
async function findNamesByUser(userId) {
  const { rows } = await pool.query(
    'SELECT name FROM properties WHERE user_id = $1 ORDER BY id ASC',
    [userId]
  );
  return rows.map(p => p.name);
}

/**
 * findFirstByUser — Devuelve el id de la primera propiedad del usuario (por id ASC).
 *
 * @param {number} userId
 * @returns {Promise<{ id: number } | null>}
 */
async function findFirstByUser(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM properties WHERE user_id = $1 ORDER BY id ASC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

/**
 * countByUser — Número total de propiedades del usuario.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function countByUser(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*) AS n FROM properties WHERE user_id = $1',
    [userId]
  );
  // PostgreSQL devuelve COUNT como string; lo convertimos a entero.
  return parseInt(rows[0].n, 10);
}

/**
 * countDefaultByUser — Número de propiedades con nombre 'Mi propiedad'.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function countDefaultByUser(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n FROM properties WHERE user_id = $1 AND name = 'Mi propiedad'`,
    [userId]
  );
  return parseInt(rows[0].n, 10);
}

// ── Funciones de escritura ─────────────────────────────────────

/**
 * create — Inserta una nueva propiedad y devuelve su id generado.
 *
 * @param {number} userId
 * @param {string} name
 * @returns {Promise<number>} id de la nueva propiedad
 */
async function create(userId, name) {
  const { rows } = await pool.query(
    'INSERT INTO properties (user_id, name) VALUES ($1, $2) RETURNING id',
    [userId, name]
  );
  return rows[0].id;
}

/**
 * createDefault — Inserta la propiedad por defecto 'Mi propiedad'.
 *
 * @param {number} userId
 * @returns {Promise<number>} id de la nueva propiedad
 */
async function createDefault(userId) {
  const { rows } = await pool.query(
    `INSERT INTO properties (user_id, name) VALUES ($1, 'Mi propiedad') RETURNING id`,
    [userId]
  );
  return rows[0].id;
}

/**
 * rename — Actualiza el nombre de una propiedad.
 *
 * @param {number} id
 * @param {string} name
 * @returns {Promise<void>}
 */
async function rename(id, name) {
  await pool.query(
    'UPDATE properties SET name = $1 WHERE id = $2',
    [name, id]
  );
}

/**
 * remove — Elimina una propiedad por id.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
async function remove(id) {
  await pool.query('DELETE FROM properties WHERE id = $1', [id]);
}

module.exports = {
  findByIdAndUser,
  findNameByIdAndUser,
  findAllByUser,
  findAllByUserOrderedByCreation,
  findNamesByUser,
  findFirstByUser,
  countByUser,
  countDefaultByUser,
  create,
  createDefault,
  rename,
  remove,
};
