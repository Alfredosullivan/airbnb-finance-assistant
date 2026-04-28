// csvParser.ts — Parser real del CSV de transacciones de Airbnb
// Extrae Payouts y los agrupa con sus reservaciones asociadas por fecha.
// También detecta el mes predominante del CSV para etiquetar el reporte.

import type {
  Reservation,
  TaxWithholdings,
  AirbnbPayout,
  AirbnbParseResult,
  DateRange,
} from '../types';

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── Columnas del CSV de Airbnb (nombres exactos) ──────────────
const COL = {
  FECHA:            'Fecha',
  TIPO:             'Tipo',
  COD_CONFIRMACION: 'Código de confirmación',
  COD_REFERENCIA:   'Código de referencia',
  FECHA_INICIO:     'Fecha de inicio',
  FECHA_FIN:        'Fecha de finalización',
  NOCHES:           'Noches',
  HUESPED:          'Huésped',
  ESPACIO:          'Espacio',
  MONEDA:           'Moneda',
  MONTO:            'Monto',
  INGRESOS_REC:     'Ingresos recibidos',
  TARIFA_SERVICIO:  'Tarifa de servicio',
  TARIFA_LIMPIEZA:  'Tarifa de limpieza',
  INGRESOS_BRUTOS:  'Ingresos brutos',
  ANNO_INGRESOS:    'Año de ingresos',
};

// ── Meses del año en español (para el label del reporte) ──────
const MESES_ES: Record<string, string> = {
  '01': 'Enero',    '02': 'Febrero', '03': 'Marzo',    '04': 'Abril',
  '05': 'Mayo',     '06': 'Junio',   '07': 'Julio',    '08': 'Agosto',
  '09': 'Septiembre','10': 'Octubre','11': 'Noviembre','12': 'Diciembre',
};

// Tipos de fila relevantes en el CSV de Airbnb
const TIPO_PAYOUT        = 'Payout';
const TIPO_RESERVACION   = 'Reservación';
const TIPO_ISR           = 'Retención del impuesto sobre la renta';
const TIPO_IVA           = 'Retención del IVA en México';
const TIPO_HOST_TAX      = 'Impuestos liquidados como anfitrión';
const TIPO_AJUSTE        = 'Ajuste de resolución';

// Tipos locales para las filas crudas del CSV (csv-parse devuelve Record<string, string>)
type CsvRow    = Record<string, string>;
type DateGroup = {
  payout:        CsvRow | null;
  reservaciones: CsvRow[];
  retenciones:   Array<{ tipo: string; row: CsvRow }>;
};

/**
 * parseAirbnbCSV — Extrae los Payouts del CSV de Airbnb con sus reservaciones
 * @param {string} filePath - Ruta absoluta al archivo CSV en disco
 * @returns {Promise<AirbnbParseResult | { error: true; message: string }>}
 */
async function parseAirbnbCSV(filePath: string): Promise<AirbnbParseResult | { error: true; message: string }> {
  try {
    const buffer = fs.readFileSync(filePath);

    // Parsear CSV con opciones para manejar BOM, espacios y columnas con nombre
    const rows = parse(buffer, {
      columns:          true,
      skip_empty_lines: true,
      bom:              true,
      trim:             true,
      relax_column_count: true, // tolerar filas con columnas faltantes
    });

    if (!rows || rows.length === 0) {
      return { error: true, message: 'El CSV está vacío o no tiene filas de datos' };
    }

    console.log(`[csvParser] Total de filas en CSV: ${rows.length}`);

    // ── Agrupar filas por fecha ────────────────────────────────
    // Cada fecha agrupa: un Payout + sus reservaciones + retenciones de ese día
    const byDate: Record<string, DateGroup> = {};

    for (const row of rows) {
      const fecha = normalizarFecha(row[COL.FECHA]);
      if (!fecha) continue; // Omitir filas sin fecha válida

      if (!byDate[fecha]) {
        byDate[fecha] = { payout: null, reservaciones: [], retenciones: [] };
      }

      const tipo = (row[COL.TIPO] || '').trim();

      if (tipo === TIPO_PAYOUT) {
        byDate[fecha].payout = row;
      } else if (tipo === TIPO_RESERVACION) {
        byDate[fecha].reservaciones.push(row);
      } else if ([TIPO_ISR, TIPO_IVA, TIPO_HOST_TAX, TIPO_AJUSTE].includes(tipo)) {
        byDate[fecha].retenciones.push({ tipo, row });
      }
    }

    // ── Construir array de Payouts estructurados ───────────────
    const payouts: AirbnbPayout[] = [];

    for (const [fecha, grupo] of Object.entries(byDate)) {
      if (!grupo.payout) continue; // Ignorar fechas sin Payout

      const payoutRow = grupo.payout;
      const moneda    = (payoutRow[COL.MONEDA] || 'MXN').trim();

      // Calcular retenciones fiscales sumando por tipo
      const taxWithholdings = calcularRetenciones(grupo.retenciones);

      // Construir el objeto Payout
      const payoutObj: AirbnbPayout = {
        date:            fecha,
        expectedDepositDate: null, // El CSV de Airbnb no incluye fecha estimada de llegada
        amount:          parseMonto(payoutRow[COL.INGRESOS_REC]),
        currency:        moneda,
        referenceCode:   (payoutRow[COL.COD_REFERENCIA] || '').trim(),
        reservations:    grupo.reservaciones.map(r => buildReservacion(r)),
        taxWithholdings,
        source:          'airbnb_csv',
      };

      payouts.push(payoutObj);
    }

    // Ordenar por fecha descendente (más reciente primero)
    // ¿Por qué .getTime()? TypeScript no permite aritmética directa entre objetos Date —
    // .getTime() convierte cada Date a número (milisegundos desde epoch) para la resta.
    payouts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calcular período cubierto
    const fechas  = payouts.map(p => p.date).sort();
    const period: DateRange | null = fechas.length > 0
      ? { from: fechas[0], to: fechas[fechas.length - 1] }
      : null;

    const totalAmount = payouts.reduce((s, p) => s + p.amount, 0);

    // ── Detectar el mes predominante (moda de YYYY-MM en los Payouts) ──
    // Se usa para etiquetar el reporte y guardar en el historial
    const { reportMonth, reportLabel } = detectarMesPredominante(payouts);

    console.log(`[csvParser] Payouts encontrados: ${payouts.length}, total: ${totalAmount.toFixed(2)} MXN`);
    console.log(`[csvParser] Mes predominante del CSV: ${reportMonth} (${reportLabel})`);

    return { payouts, period, totalAmount, reportMonth, reportLabel, source: 'airbnb_csv' };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[csvParser] Error al parsear CSV de Airbnb:', message);
    return { error: true, message: `Error al parsear CSV: ${message}` };
  }
}

// ── Helpers privados ───────────────────────────────────────────

/**
 * normalizarFecha — Convierte fechas con separador "/" al formato YYYY-MM-DD
 *
 * El CSV de Airbnb USA usa formato MM/DD/YYYY (ej: "02/28/2026").
 * El código anterior tenía dos bloques con el MISMO regex, por lo que el
 * segundo bloque (MM/DD/YYYY) era código muerto: nunca se alcanzaba.
 * Resultado: "02/28/2026" se interpretaba como dd=02, mm=28 → "2026-28-02".
 *
 * Fix: un solo regex, detectar el formato por qué campo supera el valor 12.
 *   - Si el segundo número (b) > 12 → el primero es el mes: MM/DD/YYYY
 *   - Si el primer número (a) > 12 → el segundo es el mes: DD/MM/YYYY
 *   - Ambos ≤ 12 (ambiguo) → usar MM/DD/YYYY (estándar de Airbnb USA)
 *
 * @param raw - Fecha en cualquier formato separado por "/"
 * @returns Fecha en formato YYYY-MM-DD o null si no se puede parsear
 */
function normalizarFecha(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Formato YYYY-MM-DD (ya normalizado — devolver directo)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Formato con separador "/" → detectar MM/DD/YYYY vs DD/MM/YYYY
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, a, b, yyyy] = match;
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);

    let mes, dia;

    if (numB > 12) {
      // b no puede ser mes → a=mes, b=día (formato MM/DD/YYYY)
      mes = a; dia = b;
    } else if (numA > 12) {
      // a no puede ser mes → b=mes, a=día (formato DD/MM/YYYY)
      mes = b; dia = a;
    } else {
      // Ambiguo: ambos ≤ 12. Airbnb exporta MM/DD/YYYY → a=mes, b=día
      mes = a; dia = b;
    }

    return `${yyyy}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  return null;
}

/**
 * parseMonto — Convierte string de monto a número flotante
 * Maneja formatos "$3,415.67", "3415.67", "-135.92"
 */
function parseMonto(raw: string | null | undefined): number {
  if (!raw) return 0;
  // Eliminar símbolo de moneda y comas de miles
  const clean = raw.toString().replace(/[$,\s]/g, '').trim();
  const val   = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

/**
 * buildReservacion — Construye el objeto de reservación a partir de una fila CSV
 */
function buildReservacion(row: CsvRow): Reservation {
  return {
    confirmationCode: (row[COL.COD_CONFIRMACION] || '').trim(),
    guest:            (row[COL.HUESPED]          || '').trim(),
    property:         (row[COL.ESPACIO]          || '').trim(),
    checkIn:          normalizarFecha(row[COL.FECHA_INICIO]),
    checkOut:         normalizarFecha(row[COL.FECHA_FIN]),
    nights:           parseInt(row[COL.NOCHES], 10) || 0,
    grossAmount:      parseMonto(row[COL.INGRESOS_BRUTOS]),
    serviceFee:       parseMonto(row[COL.TARIFA_SERVICIO]),
    cleaningFee:      parseMonto(row[COL.TARIFA_LIMPIEZA]),
    netAmount:        parseMonto(row[COL.MONTO]),
  };
}

/**
 * calcularRetenciones — Suma las retenciones fiscales por tipo
 */
function calcularRetenciones(retenciones: Array<{ tipo: string; row: CsvRow }>): TaxWithholdings {
  let isr     = 0;
  let iva     = 0;
  let hostTax = 0;

  for (const { tipo, row } of retenciones) {
    const monto = parseMonto(row[COL.MONTO] || row[COL.INGRESOS_REC]);
    if (tipo === TIPO_ISR)      isr     += monto;
    else if (tipo === TIPO_IVA) iva     += monto;
    else if (tipo === TIPO_HOST_TAX) hostTax += monto;
    // TIPO_AJUSTE se ignora en las retenciones (va al monto del Payout)
  }

  return { isr, iva, hostTax };
}

// ── Helpers adicionales ────────────────────────────────────────

/**
 * detectarMesPredominante — Calcula el mes que más aparece entre los Payouts
 *
 * Usa p.date.substring(0, 7) sobre la fecha YA normalizada a YYYY-MM-DD.
 * Nunca vuelve a splitear la fecha original (evita el bug de MM/DD vs DD/MM).
 *
 * @param payouts - Payouts con date en formato YYYY-MM-DD
 * @returns { reportMonth: "2026-02", reportLabel: "Febrero 2026" }
 */
function detectarMesPredominante(payouts: Array<{ date: string }>): { reportMonth: string | null; reportLabel: string } {
  if (!payouts || payouts.length === 0) {
    const now = new Date();
    const mm  = String(now.getMonth() + 1).padStart(2, '0');
    return { reportMonth: `${now.getFullYear()}-${mm}`, reportLabel: 'Reporte' };
  }

  // Contar payouts por mes. p.date ya está en YYYY-MM-DD → substring(0,7) = "YYYY-MM"
  const monthCount: Record<string, number> = {};
  payouts.forEach(p => {
    if (!p.date || p.date.length < 7) return;
    const yearMonth = p.date.substring(0, 7); // "2026-02" — nunca re-splitear raw
    monthCount[yearMonth] = (monthCount[yearMonth] || 0) + 1;
  });

  if (Object.keys(monthCount).length === 0) {
    return { reportMonth: null, reportLabel: 'Reporte' };
  }

  // Mes con más Payouts (moda)
  const reportMonth = Object.entries(monthCount)
    .sort((a, b) => b[1] - a[1])[0][0]; // "2026-02"

  // Construir label en español: "Febrero 2026"
  const [anio, mes] = reportMonth.split('-');
  const reportLabel = `${MESES_ES[mes] || mes} ${anio}`;

  console.log(`[csvParser] Mes predominante: ${reportMonth} → ${reportLabel}`);

  return { reportMonth, reportLabel };
}

module.exports = { parseAirbnbCSV };
