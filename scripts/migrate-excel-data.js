/**
 * migrate-excel-data.js
 * Actualiza excelData en todos los reportes guardados que no lo tengan
 * (o que lo tengan incompleto con noches=0).
 *
 * Extrae noches y comisión desde el JSON de cada reporte:
 *   - tables.matched[].reservations[]       — payouts coincidentes con banco
 *   - tables.onlyInAirbnb[].reservations[]  — payouts sin depósito bancario
 * Calcula IVA (8%) e ISR (4%) desde summary.airbnbTotal.
 *
 * Uso:
 *   node scripts/migrate-excel-data.js
 *
 * El script es idempotente: reportes que ya tienen noches > 0 se omiten.
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '../data/finance.db');

let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error(`[error] No se pudo abrir la base de datos en ${DB_PATH}`);
  console.error(`        ${err.message}`);
  process.exit(1);
}

const reports = db.prepare('SELECT id, month, summary FROM reports ORDER BY month ASC').all();
console.log(`\n[migración] ${reports.length} reporte${reports.length !== 1 ? 's' : ''} encontrado${reports.length !== 1 ? 's' : ''}\n`);

let actualizados = 0;
let omitidos     = 0;
let errores      = 0;

for (const report of reports) {
  let s;
  try {
    s = JSON.parse(report.summary);
  } catch (_) {
    console.log(`[error]    ${report.month} (id=${report.id}) — JSON inválido, omitido`);
    errores++;
    continue;
  }

  // Si ya tiene excelData con noches reales, omitir
  if (s.excelData && s.excelData.noches > 0) {
    console.log(`[omitido]  ${report.month} — ya tiene noches=${s.excelData.noches}`);
    omitidos++;
    continue;
  }

  // ── Extraer noches y comisión desde reservaciones ─────────────
  let noches         = 0;
  let comisionAirbnb = 0;

  // Combinar matched + onlyInAirbnb (ambos pueden tener reservaciones con noches)
  const allItems = [
    ...(s.tables?.matched      || s.matched      || []),
    ...(s.tables?.onlyInAirbnb || s.onlyInAirbnb || []),
  ];

  for (const item of allItems) {
    const reservations = item.reservations || [];

    if (reservations.length > 0) {
      // Payout con array de reservaciones (estructura principal)
      for (const res of reservations) {
        noches         += parseInt(res.nights,      10) || 0;
        comisionAirbnb += parseFloat(res.serviceFee)   || 0;
      }
    } else {
      // onlyInAirbnb items a veces tienen nights/serviceFee en el nivel raíz
      noches         += parseInt(item.nights,      10) || 0;
      comisionAirbnb += parseFloat(item.serviceFee)   || 0;
    }
  }

  // ── IVA e ISR calculados desde el neto Airbnb ─────────────────
  // Usa airbnbTotal (formatter moderno) con fallback a totalAirbnbPayouts (formato anterior)
  const airbnbTotal  = parseFloat(s.summary?.airbnbTotal || s.summary?.totalAirbnbPayouts || 0);
  const ivaRetenido  = parseFloat((airbnbTotal * 0.08).toFixed(2));
  const isrRetenido  = parseFloat((airbnbTotal * 0.04).toFixed(2));

  // ── Adjuntar excelData y persistir ────────────────────────────
  s.excelData = {
    noches,
    comisionAirbnb: parseFloat(comisionAirbnb.toFixed(2)),
    ivaRetenido,
    isrRetenido,
  };

  db.prepare('UPDATE reports SET summary = ? WHERE id = ?')
    .run(JSON.stringify(s), report.id);

  console.log(
    `[actualizado] ${report.month}` +
    ` — noches=${noches}` +
    `, comision=${comisionAirbnb.toFixed(2)}` +
    `, IVA=${ivaRetenido}` +
    `, ISR=${isrRetenido}`
  );
  actualizados++;
}

console.log(
  `\n[migración] Completada:` +
  ` ${actualizados} actualizado${actualizados !== 1 ? 's' : ''},` +
  ` ${omitidos} omitido${omitidos !== 1 ? 's' : ''},` +
  ` ${errores} error${errores !== 1 ? 'es' : ''}\n`
);

db.close();
