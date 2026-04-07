// scripts/migrate.js — Migración idempotente a PostgreSQL
// Crea las tablas (si no existen) e inserta los datos históricos del seed.json.
// Idempotente: se puede correr múltiples veces sin duplicar datos (usa ON CONFLICT DO NOTHING).
//
// Uso:
//   node scripts/migrate.js
//
// Requiere DATABASE_URL en .env (copia .env.example como guía).

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const path     = require('path');
const seed     = require('./seed.json');

// ── Validar variable de entorno ────────────────────────────────
if (!process.env.DATABASE_URL) {
  console.error('[migrate] ERROR: DATABASE_URL no está definida en .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Soporte SSL para Railway / Heroku / Render (la URL incluye sslmode=require)
  ...(process.env.DATABASE_URL.includes('sslmode=require') && {
    ssl: { rejectUnauthorized: false },
  }),
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[migrate] Conectado a PostgreSQL. Iniciando migración...');

    // ── 1. Crear tablas ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[migrate] Tabla users: OK');

    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        name       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('[migrate] Tabla properties: OK');

    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        property_id INTEGER NOT NULL,
        month       TEXT NOT NULL,
        year        INTEGER NOT NULL,
        label       TEXT NOT NULL,
        summary     TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
        UNIQUE (user_id, property_id, month)
      )
    `);
    console.log('[migrate] Tabla reports: OK');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_reports_user_property_month
      ON reports (user_id, property_id, month)
    `);
    console.log('[migrate] Índice reports: OK');

    // ── 2. Insertar datos del seed (idempotente) ───────────────
    let usersInserted      = 0;
    let propertiesInserted = 0;
    let reportsInserted    = 0;

    // Mapa old_id → new_id para mantener relaciones entre tablas
    const userIdMap     = {};
    const propertyIdMap = {};

    for (const u of seed.users) {
      const { rows } = await client.query(
        `INSERT INTO users (username, email, password_hash, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
        [u.username, u.email, u.password_hash, u.created_at || new Date().toISOString()]
      );

      if (rows.length > 0) {
        userIdMap[u.id] = rows[0].id;
        usersInserted++;
      } else {
        // El usuario ya existe — recuperar su id actual
        const existing = await client.query(
          'SELECT id FROM users WHERE username = $1',
          [u.username]
        );
        userIdMap[u.id] = existing.rows[0].id;
      }
    }
    console.log(`[migrate] Usuarios insertados: ${usersInserted} (de ${seed.users.length})`);

    for (const p of seed.properties) {
      const mappedUserId = userIdMap[p.user_id];
      if (!mappedUserId) {
        console.warn(`[migrate] Propiedad id=${p.id} sin usuario mapeado (user_id=${p.user_id}) — omitida`);
        continue;
      }

      // Las propiedades no tienen constraint UNIQUE por nombre, así que
      // buscamos por user_id + name para evitar duplicados.
      const existing = await client.query(
        'SELECT id FROM properties WHERE user_id = $1 AND name = $2',
        [mappedUserId, p.name]
      );

      if (existing.rows.length > 0) {
        propertyIdMap[p.id] = existing.rows[0].id;
      } else {
        const { rows } = await client.query(
          `INSERT INTO properties (user_id, name, created_at)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [mappedUserId, p.name, p.created_at || new Date().toISOString()]
        );
        propertyIdMap[p.id] = rows[0].id;
        propertiesInserted++;
      }
    }
    console.log(`[migrate] Propiedades insertadas: ${propertiesInserted} (de ${seed.properties.length})`);

    for (const r of seed.reports) {
      const mappedUserId     = userIdMap[r.user_id];
      const mappedPropertyId = propertyIdMap[r.property_id];

      if (!mappedUserId || !mappedPropertyId) {
        console.warn(`[migrate] Reporte mes=${r.month} sin IDs mapeados — omitido`);
        continue;
      }

      const { rowCount } = await client.query(
        `INSERT INTO reports (user_id, property_id, month, year, label, summary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, property_id, month) DO NOTHING`,
        [
          mappedUserId,
          mappedPropertyId,
          r.month,
          r.year,
          r.label,
          r.summary,
          r.created_at || new Date().toISOString(),
        ]
      );

      if (rowCount > 0) reportsInserted++;
    }
    console.log(`[migrate] Reportes insertados: ${reportsInserted} (de ${seed.reports.length})`);

    console.log('[migrate] ✅ Migración completada exitosamente');

  } catch (err) {
    console.error('[migrate] ❌ Error durante la migración:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err.message);
  process.exit(1);
});
