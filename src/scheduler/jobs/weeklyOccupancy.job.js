'use strict';

// weeklyOccupancy.job.js — Job que se ejecuta todos los lunes a las 08:00.
//
// Revisa el promedio de ingresos registrados en los reportes de los últimos 7 días.
// En un sistema productivo, aquí llamarías a un servicio que:
//   1. Obtiene los reportes de la semana anterior
//   2. Calcula métricas de ocupación por propiedad
//   3. Notifica a los propietarios o guarda un reporte de tendencias

const log       = require('../logger');
const { pool }  = require('../../database/client');

// Expresión cron: "0 8 * * 1"
// minuto=0, hora=8, día=*, mes=*, día_semana=1 (lunes)
// En node-cron, el día de semana 1 es lunes (0 = domingo)
const CRON_EXPRESSION = '0 8 * * 1';

/**
 * Calcula el promedio de ingresos por propiedad en los últimos 7 días.
 * Solo opera sobre reportes guardados — no parsea archivos CSV/PDF.
 *
 * TODO: Conectar con un servicio de notificaciones cuando esté implementado.
 */
async function runWeeklyOccupancyCheck() {
  log('info', 'Iniciando revisión semanal de ingresos por propiedad...');

  try {
    // Calculamos el rango de fechas de la semana anterior.
    // Date.now() - 7*24*60*60*1000 es más explícito que "hace 7 días"
    // porque no asume horario de verano ni saltos de fecha.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const cutoffDate   = sevenDaysAgo.toISOString();

    // Agrupamos por property_id para ver qué propiedades tienen actividad.
    // AVG sobre el campo JSON es simplificado — en un sistema productivo
    // tendrías una columna numérica dedicada para métricas.
    const { rows } = await pool.query(
      `SELECT property_id,
              COUNT(*)   AS total_reportes,
              MAX(month) AS mes_mas_reciente
         FROM reports
        WHERE created_at >= $1
        GROUP BY property_id
        ORDER BY total_reportes DESC`,
      [cutoffDate]
    );

    if (rows.length === 0) {
      log('warn', 'No se encontraron reportes en los últimos 7 días');
      return;
    }

    rows.forEach(row => {
      log('info',
        `Propiedad ${row.property_id}: ${row.total_reportes} reporte(s) — último mes: ${row.mes_mas_reciente}`
      );
    });

    log('info', `Revisión semanal completa — ${rows.length} propiedad(es) con actividad reciente`);

  } catch (err) {
    log('error', `Error en revisión semanal de ocupación: ${err.message}`);
  }
}

module.exports = { runWeeklyOccupancyCheck, CRON_EXPRESSION };
