// pdfParser.ts — Parsers de PDFs bancarios y de Airbnb
// Implementación real para BBVA México; stub para PDF de Airbnb

import type {
  BankDeposit,
  BankParseResult,
  AirbnbParseResult,
  Reservation,
  DateRange,
} from '../types';

const fs       = require('fs');
const pdfParse = require('pdf-parse');

// ── Mapa de meses abreviados en español (BBVA usa estas abreviaturas) ──
const MES_MAP: Record<string, string> = {
  ENE: '01', FEB: '02', MAR: '03', ABR: '04',
  MAY: '05', JUN: '06', JUL: '07', AGO: '08',
  SEP: '09', OCT: '10', NOV: '11', DIC: '12',
};

// ──────────────────────────────────────────────────────────────
// BBVA PARSER — reescrito para el formato real de pdf-parse
// ──────────────────────────────────────────────────────────────
//
// Formato REAL del texto extraído por pdf-parse de BBVA México:
//
//   Línea 1: DD/MESDD/MES           ← dos fechas PEGADAS sin espacio
//   Línea 2: DESCRIPCION            ← texto libre
//   Línea 3: MONTO[SALDO][SALDO]    ← números concatenados sin espacio
//   Línea 4: REF Referencia ID ...  ← referencia y detalles
//   Línea N: detalle adicional
//
// Ejemplo real:
//   13/ENE13/ENE
//   SPEI RECIBIDOARCUS FI
//   2,089.45
//   6586510576586510 Referencia 0167769794 706
//   Dlocal MX
//
// ──────────────────────────────────────────────────────────────

// Tipo local para los metadatos internos del encabezado BBVA.
// yearPeriodo y monthStart no forman parte de BankParseResult —
// son datos de trabajo que solo usa extractBBVAMovements para
// resolver el año de cada movimiento (incluyendo cruce de año).
type BBVAMeta = {
  period:         DateRange | null;
  yearPeriodo:    number;
  monthStart:     number;
  accountNumber:  string;
  openingBalance: number;
  closingBalance: number;
};

/**
 * parseBankPDF — Extrae movimientos del estado de cuenta BBVA México
 * Puede ser llamada múltiples veces (una por cada PDF bancario subido).
 * @param filePath - Ruta absoluta al PDF en disco
 * @returns Objeto con metadatos y arrays de depósitos, o { error: true, message } si falla
 */
async function parseBankPDF(filePath: string): Promise<BankParseResult | { error: true; message: string }> {
  try {
    const buffer   = fs.readFileSync(filePath);
    const { text } = await pdfParse(buffer);

    // Paso 1: extraer metadatos del encabezado (período, cuenta, saldos)
    const meta = extractBBVAMetadata(text);

    // Paso 2: parsear movimientos con el patrón real línea a línea
    const movimientos = extractBBVAMovements(text, meta);

    // Paso 3: filtrar abonos de Airbnb por todos los canales conocidos
    // SPEI RECIBIDO  — canal principal (Arcus, Dlocal, Mexipagos, STP)
    // DEPOSITO DE TERCERO API — canal alternativo detectado en nov 2025
    const DESCRIPCIONES_AIRBNB = [
      'SPEI RECIBIDO',
      'DEPOSITO DE TERCERO API',
    ];

    const airbnbDeposits = movimientos.filter(m => {
      if (m.type !== 'abono') return false;
      const desc = (m.description || '').toUpperCase();
      return DESCRIPCIONES_AIRBNB.some(prefix => desc.startsWith(prefix));
    });

    // Log individual de cada depósito detectado
    airbnbDeposits.forEach(d =>
      console.log(`[BBVA Parser] Depósito detectado: "${d.description}" → $${d.amount}`)
    );

    // Calcular total de todos los abonos del período
    const totalDeposits = movimientos
      .filter(m => m.type === 'abono')
      .reduce((s, m) => s + m.amount, 0);

    console.log(`[BBVA Parser] Período: ${meta.period?.from} al ${meta.period?.to}`);
    console.log(`[BBVA Parser] Total movimientos encontrados: ${movimientos.length}`);
    console.log(`[BBVA Parser] Depósitos Airbnb encontrados: ${airbnbDeposits.length}`);
    console.log(`[BBVA Parser] Montos:`, airbnbDeposits.map(d => d.amount));

    return {
      period:         meta.period,
      accountNumber:  meta.accountNumber,
      openingBalance: meta.openingBalance,
      closingBalance: meta.closingBalance,
      totalDeposits,
      airbnbDeposits,
      allDeposits:    movimientos.filter(m => m.type === 'abono'),
      source:         'bbva_pdf',
    };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[BBVA Parser] Error al parsear PDF BBVA:', message);
    return { error: true, message: `Error al parsear PDF bancario: ${message}` };
  }
}

/**
 * extractBBVAMetadata — Extrae período, número de cuenta y saldos del encabezado
 * El encabezado real tiene palabras pegadas: "PeriodoDEL", "No. de Cuenta1599624208"
 */
function extractBBVAMetadata(text: string): BBVAMeta {
  // "PeriodoDEL 13/01/2026 AL 12/02/2026" — sin espacio entre Periodo y DEL
  const periodoMatch = text.match(/PeriodoDEL\s+(\d{2}\/\d{2}\/\d{4})\s+AL\s+(\d{2}\/\d{2}\/\d{4})/);

  let period: DateRange | null = null;
  let yearPeriodo = new Date().getFullYear();
  let monthStart  = 1;

  if (periodoMatch) {
    const fromStr = periodoMatch[1]; // "13/01/2026"
    const toStr   = periodoMatch[2]; // "12/02/2026"
    period        = { from: parseDateDMY(fromStr), to: parseDateDMY(toStr) };
    // Año y mes de inicio → para resolver cruce de año en los movimientos
    yearPeriodo   = parseInt(fromStr.split('/')[2], 10);
    monthStart    = parseInt(fromStr.split('/')[1], 10);
  }

  // "No. de Cuenta1599624208" — el número va pegado al texto
  const cuentaMatch    = text.match(/No\.\s*de\s*Cuenta\s*(\d+)/);
  const accountNumber  = cuentaMatch ? cuentaMatch[1] : '';

  // Saldo anterior y saldo final
  const saldoAntMatch  = text.match(/Saldo Anterior\s*([\d,]+\.\d{2})/);
  const saldoFinMatch  = text.match(/Saldo Final\s*([\d,]+\.\d{2})/);

  return {
    period,
    yearPeriodo,
    monthStart,
    accountNumber,
    openingBalance: saldoAntMatch ? parseAmount(saldoAntMatch[1]) : 0,
    closingBalance: saldoFinMatch ? parseAmount(saldoFinMatch[1]) : 0,
  };
}

/**
 * extractBBVAMovements — Parsea los movimientos del estado de cuenta BBVA
 *
 * Patrón por movimiento (confirmado con pdf-parse):
 *   Línea 1: DD/MESDD/MES        ← fechas pegadas, ej: "13/ENE13/ENE"
 *   Línea 2: DESCRIPCION         ← texto, ej: "SPEI RECIBIDOARCUS FI"
 *   Línea 3: MONTO(S)            ← números pegados, ej: "8,378.2835,541.30"
 *   Línea 4+: referencia/detalle ← "Referencia 0167769794 706"
 */
function extractBBVAMovements(text: string, meta: BBVAMeta): BankDeposit[] {
  const lines       = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const year        = meta.yearPeriodo || new Date().getFullYear();
  const monthStart  = meta.monthStart  || 1;
  const movimientos: BankDeposit[] = [];

  // Regex para la línea de fecha: EXACTAMENTE dos "DD/MES" concatenados, sin nada más
  // Ejemplos válidos: "13/ENE13/ENE", "24/ENE26/ENE", "01/FEB03/FEB"
  const fechaRe = /^(\d{2}\/[A-Z]{3})(\d{2}\/[A-Z]{3})$/;

  let i = 0;
  while (i < lines.length) {

    // ── Buscar línea de fecha ──────────────────────────────────
    const fechaMatch = lines[i].match(fechaRe);
    if (!fechaMatch) { i++; continue; }

    const fechaOper = fechaMatch[1]; // "13/ENE"
    const fechaLiq  = fechaMatch[2]; // "13/ENE"
    i++;

    // ── Línea de descripción (siempre la siguiente) ────────────
    if (i >= lines.length) break;
    const descripcion = lines[i];
    i++;

    // ── Línea de montos (siempre la siguiente tras la descripción) ──
    // Extraer TODOS los números con comas/decimales de la línea,
    // ya que pueden estar concatenados: "8,378.2835,541.3035,541.30"
    if (i >= lines.length) break;
    const montosLinea = lines[i];
    const todosNums   = montosLinea.match(/[\d,]+\.\d{2}/g) || [];

    // Si la línea no contiene ningún monto numérico, este "movimiento" no
    // tiene cifras válidas → saltar sin avanzar (podría ser encabezado de sección)
    if (todosNums.length === 0) {
      // No consumimos la línea de montos para no perder texto útil
      continue;
    }
    i++;

    // El primer número es siempre el monto principal del movimiento.
    // Los siguientes son saldos operativo y de liquidación (los ignoramos).
    const montoPrincipal = parseAmount(todosNums[0]);

    // Determinar si es abono o cargo según la descripción:
    // Solo son abonos los SPEI RECIBIDO y depósitos explícitos.
    // Todo lo demás (pagos, retiros, comisiones) es cargo.
    const esAbono = /^SPEI\s*RECIBIDO/i.test(descripcion) ||
                    /^DEP[OÓ]SITO/i.test(descripcion)      ||
                    /^ABONO/i.test(descripcion);

    // ── Buscar referencia en líneas de detalle ─────────────────
    // Avanzar hasta encontrar "Referencia XXXXX" o la siguiente fecha
    let referencia = '';
    while (i < lines.length && !lines[i].match(fechaRe)) {
      const refMatch = lines[i].match(/Referencia\s+(\S+)/);
      if (refMatch) {
        referencia = refMatch[1];
        i++;
        break; // Referencia encontrada; las demás líneas son detalles adicionales
      }
      i++;
    }
    // Saltar cualquier línea de detalle restante hasta la próxima fecha
    while (i < lines.length && !lines[i].match(fechaRe)) {
      i++;
    }

    // ── Calcular año del movimiento (manejo de cruce de año) ───
    // Si el mes del movimiento es menor al mes de inicio del período,
    // el movimiento pertenece al año siguiente.
    // Ej: período NOV/2025 → ENE/2026 → ENE tiene mesNum=1 < mesStart=11 → año 2026
    const mesClave  = fechaOper.split('/')[1].toUpperCase();
    const mesNum    = parseInt(MES_MAP[mesClave] || '1', 10);
    const yearMov   = mesNum < monthStart ? year + 1 : year;

    movimientos.push({
      date:            convertBBVADate(fechaOper, yearMov),
      liquidationDate: convertBBVADate(fechaLiq,  yearMov),
      description:     descripcion,
      reference:       referencia,
      amount:          montoPrincipal,
      type:            esAbono ? 'abono' : 'cargo',
      currency:        'MXN',
      source:          'bbva_pdf',
    });
  }

  return movimientos;
}

/**
 * convertBBVADate — Convierte "DD/MES" al formato "YYYY-MM-DD"
 * @param ddMes - "13/ENE"
 * @param year  - Año ya resuelto (con manejo de cruce de año)
 */
function convertBBVADate(ddMes: string, year: number): string {
  if (!ddMes) return '';
  const [dd, mes] = ddMes.split('/');
  const mm = MES_MAP[mes && mes.toUpperCase()];
  if (!mm) return '';
  return `${year}-${mm}-${dd.padStart(2, '0')}`;
}

/**
 * parseDateDMY — Convierte "DD/MM/YYYY" a "YYYY-MM-DD"
 */
function parseDateDMY(str: string): string {
  const parts = str.split('/');
  if (parts.length !== 3) return str;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

/**
 * parseAmount — Convierte string con comas a número flotante
 * Ejemplos: "5,325.55" → 5325.55 | "25,823.57" → 25823.57
 */
function parseAmount(str: string | null | undefined): number {
  if (!str) return 0;
  const val = parseFloat(str.replace(/,/g, ''));
  return isNaN(val) ? 0 : val;
}

// ──────────────────────────────────────────────────────────────
// AIRBNB PDF PARSER (stub mejorado)
// ──────────────────────────────────────────────────────────────

/**
 * parseAirbnbPDF — Parser del PDF de reporte de Airbnb
 *
 * TODO: Airbnb no tiene un formato PDF estándar. Implementar cuando
 * se identifique la estructura exacta del PDF de reporte de Airbnb.
 * Por ahora usar el CSV que es más confiable y estructurado.
 * (El CSV se descarga desde: Airbnb → Perfil → Pagos → Historial de transacciones → Exportar CSV)
 */
async function parseAirbnbPDF(filePath: string): Promise<AirbnbParseResult> {
  console.log('[pdfParser] AVISO: parseAirbnbPDF usa datos de ejemplo. Usa el CSV para datos reales.');

  // Retornar estructura compatible con parseAirbnbCSV para no romper el pipeline.
  // Los campos faltantes de Reservation se completan con valores vacíos de stub.
  const stubReservations: Reservation[] = [
    {
      confirmationCode: 'HMX12345',
      guest:            'Rodrigo García',
      property:         '',
      checkIn:          null,
      checkOut:         null,
      nights:           3,
      grossAmount:      2850.00,
      serviceFee:       0,
      cleaningFee:      0,
      netAmount:        2850.00,
    },
    {
      confirmationCode: 'HMX12346',
      guest:            'Ana Martínez',
      property:         '',
      checkIn:          null,
      checkOut:         null,
      nights:           2,
      grossAmount:      1950.50,
      serviceFee:       0,
      cleaningFee:      0,
      netAmount:        1950.50,
    },
  ];

  return {
    payouts: [
      {
        date:                '2024-11-01',
        expectedDepositDate: null,
        amount:              2850.00,
        currency:            'MXN',
        referenceCode:       'STUB_REF_001',
        reservations:        [stubReservations[0]],
        taxWithholdings:     { isr: 0, iva: 0, hostTax: 0 },
        source:              'airbnb_pdf_stub',
      },
      {
        date:                '2024-11-08',
        expectedDepositDate: null,
        amount:              1950.50,
        currency:            'MXN',
        referenceCode:       'STUB_REF_002',
        reservations:        [stubReservations[1]],
        taxWithholdings:     { isr: 0, iva: 0, hostTax: 0 },
        source:              'airbnb_pdf_stub',
      },
    ],
    period:      { from: '2024-11-01', to: '2024-11-08' },
    totalAmount: 4800.50,
    reportMonth: '2024-11',
    reportLabel: 'Noviembre 2024',
    source:      'airbnb_pdf_stub',
  };
}

module.exports = { parseAirbnbPDF, parseBankPDF };
