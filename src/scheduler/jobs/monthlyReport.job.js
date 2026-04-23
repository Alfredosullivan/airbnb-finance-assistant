'use strict';

// monthlyReport.job.js — Job que se ejecuta el día 1 de cada mes a las 09:00.
//
// Responsabilidad única (SRP): este archivo solo sabe CUÁNDO correr
// y QUÉ datos necesita para el reporte mensual.
// La lógica de negocio real (generar el Excel, enviar email) pertenece
// a los services — este job solo los orquesta.

const log        = require('../logger');
const { pool }   = require('../../database/client');

// ─── Constantes ────────────────────────────────────────────────────────────

// Expresión cron: "0 9 1 * *"
// ┌─── segundo (omitido en node-cron v3 — usa 5 campos, no 6)
// │ ┌─── minuto  → 0
// │ │ ┌─── hora    → 9 (09:00)
// │ │ │ ┌─── día    → 1 (primer día del mes)
// │ │ │ │ ┌─── mes   → * (todos los meses)
// │ │ │ │ │ ┌─── día de semana → * (cualquiera)
// "0 9 1 * *"
const CRON_EXPRESSION = '0 9 1 * *';

// ─── Lógica del job ────────────────────────────────────────────────────────

/**
 * Revisa qué usuarios tienen actividad registrada el mes anterior
 * y registra el resultado en los logs.
 *
 * TODO: Cuando el servicio de notificaciones esté listo, reemplazar el log
 *       por una llamada a notificationService.sendMonthlyDigest(userId).
 */
async function runMonthlyReportCheck() {
  log('info', 'Iniciando verificación de reportes mensuales...');

  // Calculamos el mes anterior en formato YYYY-MM.
  // Usamos el día 0 del mes actual — que en JavaScript equivale
  // al último día del mes anterior. Así no tenemos que manejar
  // los casos de diciembre → enero manualmente.
  const now       = new Date();
  const prevDate  = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  log('info', `Mes a revisar: ${prevMonth}`);

  try {
    // Contamos los reportes guardados del mes anterior agrupados por usuario.
    // Esta query es solo informativa — no modifica datos.
    //
    // NOTA: userId = null no funciona con "WHERE user_id = $1" en PostgreSQL.
    // Si algún job necesita operar sin userId específico, debe usar
    // "WHERE user_id IS NOT NULL" o un query diferente.
    const { rows } = await pool.query(
      `SELECT user_id, COUNT(*) AS total
         FROM reports
        WHERE month LIKE $1
        GROUP BY user_id`,
      [`${prevMonth}%`]
    );

    if (rows.length === 0) {
      log('warn', `No se encontraron reportes guardados para ${prevMonth}`);
      return;
    }

    // Registramos el conteo por usuario para tener trazabilidad en los logs
    rows.forEach(row => {
      log('info', `Usuario ${row.user_id}: ${row.total} reporte(s) en ${prevMonth}`);
    });

    log('info', `Verificación completa — ${rows.length} usuario(s) con actividad en ${prevMonth}`);

  } catch (err) {
    // Capturamos el error para que un fallo en este job no derribe
    // el scheduler completo. Cada job es aislado.
    log('error', `Error al verificar reportes mensuales: ${err.message}`);
  }
}

// CommonJS: exportamos el objeto con nombre explícito para que el
// archivo index.js del scheduler pueda desestructurar limpiamente.
module.exports = { runMonthlyReportCheck, CRON_EXPRESSION };
