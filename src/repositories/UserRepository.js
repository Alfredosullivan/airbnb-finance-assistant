// UserRepository.js — Acceso a datos del modelo User (PostgreSQL)
// Encapsula todas las consultas SQL sobre la tabla `users`.
// Los controladores NUNCA deben importar `pool` directamente para usuarios.

'use strict';

const { pool } = require('../database/client');

/**
 * findByUsernameOrEmail — Verifica si ya existe un usuario con ese username o email.
 * Usado en el flujo de registro para evitar duplicados.
 *
 * @param {string} username
 * @param {string} email
 * @returns {Promise<{ id: number } | null>}
 */
async function findByUsernameOrEmail(username, email) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );
  return rows[0] || null;
}

/**
 * create — Inserta un nuevo usuario y devuelve su id generado.
 *
 * @param {string} username     - Nombre de usuario limpio (trim)
 * @param {string} email        - Email en minúsculas
 * @param {string} passwordHash - Hash bcrypt (12 rounds)
 * @returns {Promise<number>} id del nuevo usuario
 */
async function create(username, email, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [username, email, passwordHash]
  );
  return rows[0].id;
}

/**
 * findByEmail — Busca un usuario por email para autenticación.
 *
 * @param {string} email
 * @returns {Promise<{ id, username, email, password_hash } | null>}
 */
async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, username, email, password_hash FROM users WHERE email = $1',
    [email]
  );
  return rows[0] || null;
}

/**
 * findById — Devuelve los datos públicos de un usuario (sin password_hash).
 * Usado para verificar que el usuario del JWT todavía existe en DB.
 *
 * @param {number} id
 * @returns {Promise<{ id, username, email } | null>}
 */
async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, username, email FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

module.exports = { findByUsernameOrEmail, create, findByEmail, findById };
