'use strict';

// annualSummary.job.js — Job que se ejecuta el 1 de enero de cada año a las 07:00.
//
// Genera un resumen del año anterior: total de reportes por usuario y por propiedad.
// Es el job más "costoso" del scheduler porque puede procesar muchos registros.
// Por eso corre a las 07:00 — antes del horario pico de uso de la app.
//
// TODO: Conectar con el servicio de exportación Excel para generar
//       automáticamente el reporte anual y enviarlo por email.

const log       = require('../logger');
const { pool }  = require('../../database/client');

// Expresión cron: "0 7 1 1 *"
// minuto=0, hora=7, día=1, mes=1 (enero), día_semana=* (cualquiera)
// Solo dispara una vez al año — el 1 de enero a las 07:00
const CRON_EXPRESSION = '0 7 1 1 *';

/**
 * Genera un resumen estadístico del año anterior.
 * Agrupa los reportes guardados por usuario y por propiedad.
 *
 * @returns {Promise<void>}
 */
async function runAnnualSummary() {
  // El año anterior es el año actual menos 1.
  // Este job corre el 1 de enero, así que "el año actual" ya es el nuevo año.
  const previousYear = new Date().getFullYear() - 1;

  log('info', `Generando resumen anual para el año ${previousYear}...`);

  try {
    // Query 1: total de reportes guardados en el año anterior, agrupados por usuario.
    // LIKE '$year-%' captura todos los meses del año (2024-01, 2024-02, ... 2024-12).
    const { rows: byUser } = await pool.query(
      `SELECT u.email,
              COUNT(r.id) AS total_reportes
         FROM reports r
         JOIN users   u ON u.id = r.user_id
        WHERE r.month LIKE $1
        GROUP BY u.email
        ORDER BY total_reportes DESC`,
      [`${previousYear}-%`]
    );

    if (byUser.length === 0) {
      log('warn', `No se encontraron reportes para el año ${previousYear}`);
      return;
    }

    log('info', `─── Resumen por usuario (${previousYear}) ───`);
    byUser.forEach(row => {
      log('info', `  ${row.email}: ${row.total_reportes} reporte(s)`);
    });

    // Query 2: total de reportes agrupados por propiedad.
    // Esto muestra qué propiedades tienen mayor actividad registrada.
    const { rows: byProp } = await pool.query(
      `SELECT p.name          AS propiedad,
              COUNT(r.id)     AS total_reportes,
              u.email         AS propietario
         FROM reports    r
         JOIN properties p ON p.id = r.property_id
         JOIN users      u ON u.id = r.user_id
        WHERE r.month LIKE $1
        GROUP BY p.name, u.email
        ORDER BY total_reportes DESC`,
      [`${previousYear}-%`]
    );

    log('info', `─── Resumen por propiedad (${previousYear}) ───`);
    byProp.forEach(row => {
      log('info', `  ${row.propiedad} (${row.propietario}): ${row.total_reportes} reporte(s)`);
    });

    // Totales globales para el log de cierre
    const totalReportes = byUser.reduce((acc, r) => acc + parseInt(r.total_reportes, 10), 0);
    log('info', `Resumen anual ${previousYear} completo — ${totalReportes} reporte(s) en total, ${byUser.length} usuario(s)`);

  } catch (err) {
    log('error', `Error al generar resumen anual ${previousYear}: ${err.message}`);
  }
}

module.exports = { runAnnualSummary, CRON_EXPRESSION };
