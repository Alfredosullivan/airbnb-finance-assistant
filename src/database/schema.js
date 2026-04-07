// schema.js — Definición del esquema PostgreSQL
// Crea las tablas si no existen. Es idempotente gracias a IF NOT EXISTS.
// Se ejecuta una vez al arrancar el servidor (o al inicializar el test app).

'use strict';

const { pool } = require('./client');

/**
 * initSchema — Inicializa las tablas users, properties y reports en PostgreSQL.
 * Usa CREATE TABLE IF NOT EXISTS, por lo que es seguro llamarla múltiples veces.
 *
 * @returns {Promise<void>}
 */
async function initSchema() {
  // ── Tabla de usuarios ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL      PRIMARY KEY,
      username      TEXT        UNIQUE NOT NULL,
      email         TEXT        UNIQUE NOT NULL,
      password_hash TEXT        NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Tabla de propiedades ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id         SERIAL      PRIMARY KEY,
      user_id    INTEGER     NOT NULL,
      name       TEXT        NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ── Tabla de reportes ──────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id          SERIAL      PRIMARY KEY,
      user_id     INTEGER     NOT NULL,
      property_id INTEGER     NOT NULL,
      month       TEXT        NOT NULL,
      year        INTEGER     NOT NULL,
      label       TEXT        NOT NULL,
      summary     TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      UNIQUE (user_id, property_id, month)
    )
  `);

  // ── Índice para consultas por propiedad ────────────────────────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reports_user_property_month
    ON reports (user_id, property_id, month)
  `);

  console.log('[DB] Esquema PostgreSQL verificado/inicializado correctamente');
}

module.exports = { initSchema };
