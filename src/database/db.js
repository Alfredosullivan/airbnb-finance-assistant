// db.js — Inicialización de la base de datos SQLite
// Usa better-sqlite3 (API síncrona) para simplicidad en un servidor de un solo hilo

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// Ruta a la carpeta data/ en la raíz del proyecto
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

// Crear la carpeta si no existe (sucede en la primera ejecución)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[DB] Carpeta de datos creada: ${DATA_DIR}`);
}

// In test environments (NODE_ENV=test), DB_PATH can be overridden via env var.
// Setting it to ':memory:' gives each Jest worker a fresh, isolated SQLite database.
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'finance.db');

// Crear la conexión. Si el archivo no existe, lo crea automáticamente.
const db = new Database(DB_PATH);

// WAL mode: mejor rendimiento en lecturas concurrentes
db.pragma('journal_mode = WAL');
// Claves foráneas activas
db.pragma('foreign_keys = ON');

console.log(`[DB] Conectado a: ${DB_PATH}`);

module.exports = db;
