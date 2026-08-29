/**
 * fix-negative-comision.js
 * Identifica reportes en PostgreSQL con excelData.comisionAirbnb negativa y
 * convierte el valor a su magnitud positiva (Math.abs). No modifica reportes
 * cuyo valor ya sea >= 0.
 *
 * Causa: antes de DEV-004, la Fuente 1 de saveReport (sesión activa) no aplicaba
 * Math.abs() sobre serviceFee, guardando comisionAirbnb negativa cuando el CSV de
 * Airbnb reporta la comisión como deducción (ej. -200).
 *
 * Uso:
 *   node scripts/fix-negative-comision.js --dry-run   # audita sin modificar
 *   node scripts/fix-negative-comision.js             # aplica cambios en transacción
 *
 * Requiere DATABASE_URL en .env (o en el entorno).
 */

'use strict';

require('dotenv').config();

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// ── Validar entorno ────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  console.error('[fix-comision] ERROR: DATABASE_URL no está definida en .env');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

// ── Conexión ───────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL.includes('sslmode=require') && {
    ssl: { rejectUnauthorized: false },
  }),
});

// ── Helpers ────────────────────────────────────────────────────

/** Formatea un número como string con 2 decimales para el log */
function fmt(n) {
  return Number(n).toFixed(2);
}

/** Retorna la fecha/hora actual en ISO para el audit log */
function nowIso() {
  return new Date().toISOString();
}

// ── Lógica principal ───────────────────────────────────────────

async function run() {
  const startedAt = nowIso();
  console.log(`\n[fix-comision] ${startedAt} — inicio (dry-run: ${dryRun})\n`);

  const client = await pool.connect();

  let totalExaminados;
  let totalAfectados = 0;
  let totalOmitidos = 0;
  let totalErrores = 0;

  /** Registros afectados para el audit log */
  const auditAfectados = [];

  try {
    if (!dryRun) {
      await client.query('BEGIN');
    }

    // ── 1. Leer todos los reportes ─────────────────────────────
    // El filtro se realiza en JavaScript para evitar que un JSON inválido
    // rompa un casting SQL (summary es TEXT, no JSONB).
    const { rows } = await client.query(
      'SELECT id, month, summary FROM reports ORDER BY month ASC'
    );

    totalExaminados = rows.length;
    console.log(`[fix-comision] ${totalExaminados} reporte(s) a examinar\n`);

    // ── 2. Filtrar y actualizar ────────────────────────────────
    for (const row of rows) {
      // Protección 1: JSON inválido
      let s;
      try {
        s = JSON.parse(row.summary);
      } catch (_) {
        console.log(`[error]    id=${row.id} | ${row.month} — JSON inválido, omitido`);
        totalErrores++;
        continue;
      }

      // Protección 2: excelData ausente
      if (!s.excelData) {
        console.log(`[omitido]  id=${row.id} | ${row.month} — sin excelData`);
        totalOmitidos++;
        continue;
      }

      const comision = s.excelData.comisionAirbnb;

      // Protección 3: campo ausente o null
      if (comision === undefined || comision === null) {
        console.log(`[omitido]  id=${row.id} | ${row.month} — comisionAirbnb ausente/null`);
        totalOmitidos++;
        continue;
      }

      // Protección 4: tipo inesperado o NaN/Infinity
      if (typeof comision !== 'number' || !isFinite(comision)) {
        console.log(
          `[omitido]  id=${row.id} | ${row.month} — comisionAirbnb tipo inválido (${typeof comision}: ${comision})`
        );
        totalOmitidos++;
        continue;
      }

      // Protección 5: ya positiva o cero
      if (comision >= 0) {
        console.log(
          `[omitido]  id=${row.id} | ${row.month} — comisionAirbnb=${fmt(comision)} (ya no negativa)`
        );
        totalOmitidos++;
        continue;
      }

      // ── Registro afectado ──────────────────────────────────
      const magnitud = parseFloat(Math.abs(comision).toFixed(2));
      totalAfectados++;

      auditAfectados.push({
        id: row.id,
        month: row.month,
        antes: comision,
        despues: magnitud,
      });

      if (dryRun) {
        console.log(
          `[dry-run]  id=${row.id} | ${row.month} — comisionAirbnb: ${fmt(comision)} → ${fmt(magnitud)}`
        );
        continue;
      }

      // ── Modificar ÚNICAMENTE comisionAirbnb ───────────────
      s.excelData.comisionAirbnb = magnitud;
      const nuevoSummary = JSON.stringify(s);

      const { rowCount } = await client.query('UPDATE reports SET summary = $1 WHERE id = $2', [
        nuevoSummary,
        row.id,
      ]);

      // Verificación de integridad post-UPDATE
      if (rowCount !== 1) {
        throw new Error(
          `UPDATE inesperado: se esperaba rowCount=1, se obtuvo rowCount=${rowCount} para id=${row.id}`
        );
      }

      console.log(
        `[corregido] id=${row.id} | ${row.month} — comisionAirbnb: ${fmt(comision)} → ${fmt(magnitud)}`
      );
    }

    // ── 3. Confirmar transacción ───────────────────────────────
    if (!dryRun) {
      await client.query('COMMIT');
    }
  } catch (err) {
    if (!dryRun) {
      try {
        await client.query('ROLLBACK');
        console.error('\n[fix-comision] ROLLBACK ejecutado — ningún cambio fue persistido');
      } catch (rollbackErr) {
        console.error('[fix-comision] Error en ROLLBACK:', rollbackErr.message);
      }
    }
    console.error(`\n[fix-comision] ERROR: ${err.message}`);
    process.exitCode = 1;
    return;
  } finally {
    client.release();
    await pool.end();
  }

  // ── 4. Resumen ─────────────────────────────────────────────
  const finishedAt = nowIso();
  const modo = dryRun ? 'Simulación (sin cambios)' : 'Corrección aplicada';

  console.log(`
[fix-comision] ${modo} — ${finishedAt}
  Total examinados:               ${totalExaminados}
  Afectados (comisionAirbnb < 0): ${totalAfectados}
  Omitidos:                       ${totalOmitidos}
  Errores (JSON/datos):           ${totalErrores}
`);

  // ── 5. Audit log JSON (opcional) ──────────────────────────
  // Escribe un archivo .json con los registros afectados para evidencia inmutable.
  // No es requisito para la corrección — es solo para trazabilidad.
  if (auditAfectados.length > 0) {
    const auditLog = {
      executedAt: startedAt,
      finishedAt,
      dryRun,
      totals: {
        examinados: totalExaminados,
        afectados: totalAfectados,
        omitidos: totalOmitidos,
        errores: totalErrores,
      },
      affected: auditAfectados,
    };

    const auditDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

    const auditFileName = `fix-comision-audit-${startedAt.replace(/[:.]/g, '-')}.json`;
    const auditPath = path.join(auditDir, auditFileName);

    try {
      fs.writeFileSync(auditPath, JSON.stringify(auditLog, null, 2), 'utf8');
      console.log(`[fix-comision] Audit log guardado en: data/${auditFileName}`);
    } catch (writeErr) {
      console.warn(`[fix-comision] No se pudo escribir el audit log: ${writeErr.message}`);
    }
  }
}

run().catch((err) => {
  console.error('[fix-comision] Error fatal no capturado:', err.message);
  process.exit(1);
});
