// src/database/client.js — Conexión PostgreSQL (pool de conexiones)
// En test (NODE_ENV=test) usa pg-mem (base de datos en memoria compatible con PostgreSQL).
// En producción usa el Pool de pg apuntando a DATABASE_URL en .env.
//
// El pool es un singleton de módulo: todos los repositorios importan este mismo objeto.

'use strict';

const { Pool } = require('pg');

let pool;

if (process.env.NODE_ENV === 'test') {
  // pg-mem provee una implementación en memoria de PostgreSQL compatible con la API de pg.
  // Cada worker de Jest tiene su propio proceso Node → su propio módulo → su propio pool
  // aislado. No se necesita limpiar entre archivos de test, solo entre casos (DELETE FROM...).
  const { newDb } = require('pg-mem');
  const mem = newDb();
  const { Pool: MemPool } = mem.adapters.createPg();
  pool = new MemPool();
} else {
  // Producción / desarrollo: leer DATABASE_URL desde .env
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // En Railway / Render es común que la URL incluya SSL pero el cert no sea confiable.
    // Solo activamos ssl: { rejectUnauthorized: false } si DATABASE_URL lo requiere.
    ...(process.env.DATABASE_URL?.includes('sslmode=require') && {
      ssl: { rejectUnauthorized: false },
    }),
  });

  // Loguear errores del pool (conexiones caídas, timeouts) sin crashear el proceso
  pool.on('error', (err) => {
    console.error('[DB] Error inesperado en cliente del pool:', err.message);
  });
}

module.exports = { pool };
