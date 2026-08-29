/**
 * fix-negative-comision.js
 * Identifica reportes con excelData.comisionAirbnb negativa y convierte el valor
 * a su magnitud positiva (Math.abs). No modifica reportes cuyo valor ya sea >= 0.
 *
 * Causa: antes de DEV-004, la Fuente 1 de saveReport (sesión activa) no aplicaba
 * Math.abs() sobre serviceFee, guardando comisionAirbnb negativa cuando el CSV de
 * Airbnb reporta la comisión como deducción (ej. -200).
 *
 * Uso:
 *   node scripts/fix-negative-comision.js           # aplica cambios
 *   node scripts/fix-negative-comision.js --dry-run # muestra sin modificar
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/finance.db');
const dryRun = process.argv.includes('--dry-run');

let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error(`[error] No se pudo abrir la base de datos en ${DB_PATH}`);
  console.error(`        ${err.message}`);
  process.exit(1);
}

if (dryRun) {
  console.log('\n[modo] --dry-run activo: no se realizarán cambios en la base de datos\n');
}

const reports = db.prepare('SELECT id, month, summary FROM reports ORDER BY month ASC').all();
console.log(
  `\n[fix-comision] ${reports.length} reporte${reports.length !== 1 ? 's' : ''} encontrado${reports.length !== 1 ? 's' : ''}\n`
);

let corregidos = 0;
let omitidos = 0;
let errores = 0;

for (const report of reports) {
  let s;
  try {
    s = JSON.parse(report.summary);
  } catch (_) {
    console.log(`[error]    ${report.month} (id=${report.id}) — JSON inválido, omitido`);
    errores++;
    continue;
  }

  const comision = s.excelData?.comisionAirbnb;

  // Omitir si no tiene excelData, si el valor está ausente, o si ya es positivo o cero
  if (comision === undefined || comision === null || comision >= 0) {
    console.log(`[omitido]  ${report.month} — comisionAirbnb=${comision ?? 'sin dato'}`);
    omitidos++;
    continue;
  }

  const magnitud = parseFloat(Math.abs(comision).toFixed(2));

  if (dryRun) {
    console.log(`[dry-run]  ${report.month} — comisionAirbnb: ${comision} → ${magnitud}`);
    corregidos++;
    continue;
  }

  s.excelData.comisionAirbnb = magnitud;
  db.prepare('UPDATE reports SET summary = ? WHERE id = ?').run(JSON.stringify(s), report.id);

  console.log(`[corregido] ${report.month} — comisionAirbnb: ${comision} → ${magnitud}`);
  corregidos++;
}

console.log(
  `\n[fix-comision] ${dryRun ? 'Simulación' : 'Corrección'} completada:` +
    ` ${corregidos} corregido${corregidos !== 1 ? 's' : ''},` +
    ` ${omitidos} omitido${omitidos !== 1 ? 's' : ''},` +
    ` ${errores} error${errores !== 1 ? 'es' : ''}\n`
);

db.close();
