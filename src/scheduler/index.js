'use strict';

// src/scheduler/index.js — Punto de entrada del módulo scheduler.
//
// Responsabilidad: registrar todos los cron jobs y exponerlos
// como una unidad cohesiva. El módulo sigue el patrón de "inicialización
// explícita" — los jobs NO se registran al hacer require(), sino solo
// cuando se llama initScheduler(). Esto es crítico para los tests:
// al importar este módulo en un test no se activan timers reales.
//
// Flujo de arranque:
//   index.js (raíz) → initSchema() → initScheduler() → cron jobs activos

const cron = require('node-cron');

const log = require('./logger');

// Importamos cada job con su expresión cron y su función ejecutora.
// Separar la EXPRESIÓN de la FUNCIÓN permite cambiar el horario sin
// tocar la lógica del job — principio Open/Closed aplicado.
const { runMonthlyReportCheck, CRON_EXPRESSION: MONTHLY  } = require('./jobs/monthlyReport.job');
const { runWeeklyOccupancyCheck, CRON_EXPRESSION: WEEKLY  } = require('./jobs/weeklyOccupancy.job');
const { runAnnualSummary, CRON_EXPRESSION: ANNUAL          } = require('./jobs/annualSummary.job');

// ─── Registro de jobs ──────────────────────────────────────────────────────

/**
 * Registra todos los cron jobs y los activa.
 * Debe llamarse UNA VEZ, después de que la base de datos esté lista.
 *
 * ¿Por qué después de la DB? Los jobs hacen queries a PostgreSQL.
 * Si el pool no está listo y el job dispara, obtenemos un error de conexión.
 * Al llamar initScheduler() dentro del .then() de initSchema(), garantizamos
 * el orden correcto: DB lista → scheduler activo.
 */
function initScheduler() {
  log('info', 'Iniciando scheduler...');

  // node-cron valida la expresión antes de registrar.
  // Si la expresión es inválida, lanza un error en el arranque — lo cual
  // es exactamente lo que queremos: fallar rápido y visible, no silencioso.

  cron.schedule(MONTHLY, runMonthlyReportCheck, {
    scheduled: true,
    // timezone: 'America/Mexico_City' — descomentar si el servidor corre en UTC
    // y los reportes deben disparar a las 09:00 hora de México.
  });
  log('info', `Job registrado: Monthly Report Check  [${MONTHLY}]`);

  cron.schedule(WEEKLY, runWeeklyOccupancyCheck, {
    scheduled: true,
  });
  log('info', `Job registrado: Weekly Occupancy Check [${WEEKLY}]`);

  cron.schedule(ANNUAL, runAnnualSummary, {
    scheduled: true,
  });
  log('info', `Job registrado: Annual Summary          [${ANNUAL}]`);

  log('info', `Scheduler activo — ${3} job(s) registrados`);
}

// Exportamos solo initScheduler.
// Los jobs individuales NO se exportan desde aquí — solo son accesibles
// internamente. Esto encapsula el módulo y evita que código externo
// dispare jobs manualmente de forma accidental.
module.exports = { initScheduler };
