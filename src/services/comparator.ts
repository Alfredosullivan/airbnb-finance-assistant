// comparator.ts — Servicio de comparación de transacciones Airbnb vs banco
// Cruza Payouts de Airbnb con depósitos SPEI en el estado de cuenta BBVA.
// Filtrado estricto por mes calendario (sin ventana de ±7 días).

import type {
  AirbnbPayout,
  AirbnbParseResult,
  BankDeposit,
  BankParseResult,
  ReconciliationResult,
  MatchedTransaction,
  DateRange,
} from '../types';

const AMOUNT_TOLERANCE = 1.00; // Tolerancia de monto en MXN (redondeos bancarios)

// Tipo local: bankData acepta el formato nuevo (objeto con bankPdf1/bankPdf2)
// y el formato legado (array plano de depósitos) para compatibilidad hacia atrás.
type BankDataObject = { bankPdf1?: BankParseResult | null; bankPdf2?: BankParseResult | null };
type BankDataInput  = BankDeposit[] | BankDataObject;

// Tipo local: candidatos del algoritmo de cruce (payout ↔ depósito)
type Candidate = { dep: BankDeposit; idx: number };

/**
 * compareTransactions — Cruza los Payouts de Airbnb con los depósitos bancarios
 *
 * @param airbnbData  - Salida de parseAirbnbCSV / parseAirbnbPDF, o array legado
 * @param bankData    - Salida de parseBankPDF (objeto con bankPdf1/bankPdf2), o array legado
 * @param reportMonth - Mes del reporte "YYYY-MM"; filtra ambos lados al mes exacto
 * @returns Resultado estructurado con matched, onlyInAirbnb, onlyInBank, differences y totales
 */
function compareTransactions(
  airbnbData:  AirbnbParseResult | AirbnbPayout[],
  bankData:    BankDataInput,
  reportMonth: string | null = null
): ReconciliationResult {

  // ── Normalizar entradas ────────────────────────────────────────

  // Extraer array de Payouts de Airbnb
  const payouts: AirbnbPayout[] = Array.isArray(airbnbData)
    ? airbnbData                       // compatibilidad legado
    : (airbnbData.payouts || []);

  // Extraer depósitos bancarios de Airbnb de ambos PDFs y combinarlos
  let bankPdf1: BankDeposit[];
  let bankPdf2: BankDeposit[];
  let allBankDeposits: BankDeposit[];

  if (Array.isArray(bankData)) {
    // Modo legado: array plano
    bankPdf1        = bankData;
    bankPdf2        = [];
    allBankDeposits = bankData;
  } else {
    bankPdf1        = (bankData.bankPdf1 && bankData.bankPdf1.airbnbDeposits) || [];
    bankPdf2        = (bankData.bankPdf2 && bankData.bankPdf2.airbnbDeposits) || [];
    allBankDeposits = [...bankPdf1, ...bankPdf2];
  }

  // ── Determinar mes activo ──────────────────────────────────────
  const mesActivo = reportMonth || (Array.isArray(airbnbData) ? null : airbnbData.reportMonth) || null;

  // mesValido: boolean explícito — evita que TypeScript infiera string | null | boolean.
  // !!() garantiza que el resultado sea siempre true | false.
  const MONTH_RE  = /^\d{4}-(0[1-9]|1[0-2])$/;
  const mesValido: boolean = !!(mesActivo && MONTH_RE.test(mesActivo));

  if (!mesValido && mesActivo) {
    console.error('[comparator] reportMonth inválido, se ignorará el filtro:', mesActivo);
  }

  console.log('[comparator] reportMonth activo:', mesActivo, '| válido:', mesValido);
  console.log('[comparator] Total payouts Airbnb:', payouts.length);
  console.log('[comparator] Total depósitos bancarios combinados:', allBankDeposits.length);

  // ── Filtrar payouts al mes activo (filtro estricto por mes calendario) ──
  // mesActivo! — non-null assertion segura: solo se llega aquí cuando mesValido es true,
  // que solo puede ser true si mesActivo es un string no-nulo (por la condición &&).
  const payoutsActivos: AirbnbPayout[] = mesValido
    ? payouts.filter(p => p.date && p.date.startsWith(mesActivo!))
    : payouts;

  // ── Filtrar depósitos bancarios al mes activo (filtro estricto) ──────────
  const depositosFiltrados: BankDeposit[] = mesValido
    ? allBankDeposits.filter(dep => {
        const fechaDep = dep.date || dep.liquidationDate || '';
        return fechaDep.startsWith(mesActivo!);
      })
    : allBankDeposits;

  console.log(`[comparator] Payouts activos: ${payoutsActivos.length}/${payouts.length}`);
  console.log(`[comparator] Depósitos filtrados: ${depositosFiltrados.length}/${allBankDeposits.length}`);
  if (depositosFiltrados.length > 0) {
    console.log('[comparator] Muestra depósitos filtrados:',
      depositosFiltrados.slice(0, 3).map(d => ({ date: d.date, amount: d.amount }))
    );
  }

  // Totales para desglose en el reporte
  // d.amount ya es number (tipado en BankDeposit) — no necesita parseFloat
  const bankDepositsInMonth = depositosFiltrados.reduce((s, d) => s + (d.amount || 0), 0);
  const otherBankMovements  = allBankDeposits
    .filter(dep => !depositosFiltrados.includes(dep))
    .reduce((s, d) => s + (d.amount || 0), 0);

  // Propagar mes activo final (null si era inválido)
  const mesActivoFinal = mesValido ? mesActivo : null;

  // ── Algoritmo de cruce (usa conjuntos filtrados) ───────────────
  const matched: MatchedTransaction[] = [];
  const onlyInAirbnb: AirbnbPayout[]  = [];
  const usedBankIdx = new Set<number>();

  for (const payout of payoutsActivos) {
    const payoutDate = new Date(payout.date);

    const candidatos: Candidate[] = depositosFiltrados
      .map((dep, idx): Candidate => ({ dep, idx }))
      .filter(({ dep, idx }) => {
        if (usedBankIdx.has(idx)) return false;
        return Math.abs((dep.amount || 0) - payout.amount) <= AMOUNT_TOLERANCE;
      });

    if (candidatos.length === 0) {
      onlyInAirbnb.push(payout);
      continue;
    }

    // Elegir el candidato más cercano en fecha
    // .getTime() — TypeScript requiere conversión numérica explícita para restar Dates
    const mejor = candidatos.reduce((prev, curr) => {
      const dP = Math.abs(payoutDate.getTime() - new Date(prev.dep.date || prev.dep.liquidationDate || '').getTime());
      const dC = Math.abs(payoutDate.getTime() - new Date(curr.dep.date || curr.dep.liquidationDate || '').getTime());
      return dC < dP ? curr : prev;
    });

    usedBankIdx.add(mejor.idx);

    const depDate    = new Date(mejor.dep.date || mejor.dep.liquidationDate || '');
    const daysDiff   = Math.round((depDate.getTime() - payoutDate.getTime()) / (1000 * 60 * 60 * 24));
    const amountDiff = Math.round((payout.amount - (mejor.dep.amount || 0)) * 100) / 100;

    matched.push({
      airbnbPayout: {
        date:          payout.date,
        amount:        payout.amount,
        currency:      payout.currency || 'MXN',
        referenceCode: payout.referenceCode || '',
        reservations:  payout.reservations  || [],
      },
      bankDeposit: {
        date:        mejor.dep.date,
        amount:      mejor.dep.amount,
        description: mejor.dep.description || '',
        reference:   mejor.dep.reference   || '',
      },
      daysDifference:   daysDiff,
      amountDifference: amountDiff,
      status: Math.abs(amountDiff) <= AMOUNT_TOLERANCE ? 'matched' : 'matched_with_diff',
    });
  }

  // Depósitos filtrados sin Payout → onlyInBank
  console.log(`[comparator] onlyInBank candidates: ${depositosFiltrados.length}`);
  const onlyInBank: BankDeposit[]         = depositosFiltrados.filter((_, idx) => !usedBankIdx.has(idx));
  console.log(`[comparator] onlyInBank final: ${onlyInBank.length}`);

  // Subconjunto de matched donde el monto Airbnb ≠ monto banco
  const differences: MatchedTransaction[] = matched.filter(m => Math.abs(m.amountDifference) > 0);

  // ── Calcular totales ───────────────────────────────────────────
  const totalAirbnbPayouts = payoutsActivos.reduce((s, p) => s + (p.amount || 0), 0);
  const totalBankDeposits  = depositosFiltrados.reduce((s, d) => s + (d.amount || 0), 0);
  const difference         = Math.round((totalAirbnbPayouts - totalBankDeposits) * 100) / 100;
  const netDifference      = difference; // alias semántico
  const bankAllMonths      = allBankDeposits.reduce((s, d) => s + (d.amount || 0), 0);
  const bankAllMonthsCount = allBankDeposits.length;

  const avgDays = matched.length > 0
    ? matched.reduce((s, m) => s + m.daysDifference, 0) / matched.length
    : 0;

  // ── Narrowing de bankData para acceder a bankPdf1/bankPdf2 ─────
  // Fuera del if/else TypeScript no sabe si bankData es array u objeto.
  // bankDataObj centraliza el narrowing de forma type-safe sin 'any'.
  const bankDataObj  = Array.isArray(bankData) ? null : bankData;
  const bankPeriod   = combinePeriods(
    bankDataObj?.bankPdf1 ? bankDataObj.bankPdf1.period : null,
    bankDataObj?.bankPdf2 ? bankDataObj.bankPdf2.period : null,
  );
  const airbnbPeriod = Array.isArray(airbnbData) ? null : (airbnbData.period || null);

  return {
    matched,
    onlyInAirbnb,
    onlyInBank,
    differences,
    totals: {
      totalAirbnbPayouts:   Math.round(totalAirbnbPayouts   * 100) / 100,
      totalBankDeposits:    Math.round(totalBankDeposits     * 100) / 100,
      bankDepositsInMonth:  Math.round(bankDepositsInMonth   * 100) / 100,
      otherBankMovements:   Math.round(otherBankMovements    * 100) / 100,
      difference,
      netDifference,
      matchRate:            calcMatchRate(matched.length, payoutsActivos.length),
      averageDaysToDeposit: Math.round(avgDays * 10) / 10,
      bankAllMonths:        Math.round(bankAllMonths         * 100) / 100,
      bankAllMonthsCount,
    },
    periods: {
      airbnb: airbnbPeriod,
      bank:   bankPeriod,
    },
    reportMonth:  mesActivoFinal,
    reportLabel:  Array.isArray(airbnbData)
      ? (mesActivoFinal || 'Reporte')
      : (airbnbData.reportLabel || mesActivoFinal || 'Reporte'),
    sourceSummary: {
      bankPdf1Count: bankPdf1.length,
      bankPdf2Count: bankPdf2.length,
    },
  };
}

// ── Helpers privados ───────────────────────────────────────────

function calcMatchRate(matched: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((matched / total) * 100)}%`;
}

/**
 * combinePeriods — Combina dos períodos { from, to } en el rango total
 */
function combinePeriods(p1: DateRange | null, p2: DateRange | null): DateRange | null {
  if (!p1 && !p2) return null;
  if (!p1) return p2;
  if (!p2) return p1;
  const from = p1.from < p2.from ? p1.from : p2.from;
  const to   = p1.to   > p2.to   ? p1.to   : p2.to;
  return { from, to };
}

module.exports = { compareTransactions };
