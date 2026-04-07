// comparator.js — Servicio de comparación de transacciones Airbnb vs banco
// Cruza Payouts de Airbnb con depósitos SPEI en el estado de cuenta BBVA.
// Filtrado estricto por mes calendario (sin ventana de ±7 días).

const AMOUNT_TOLERANCE = 1.00; // Tolerancia de monto en MXN (redondeos bancarios)

/**
 * compareTransactions — Cruza los Payouts de Airbnb con los depósitos bancarios
 *
 * @param {Object} airbnbData
 *   Salida de parseAirbnbCSV / parseAirbnbPDF:
 *   { payouts: Array, period: Object, totalAmount: number,
 *     reportMonth: string, reportLabel: string, source: string }
 *
 * @param {{ bankPdf1: Object, bankPdf2: Object|null }} bankData
 *   Salida de parseBankPDF por cada PDF bancario.
 *   También acepta Array plano por compatibilidad hacia atrás.
 *
 * @param {string|null} [reportMonth]
 *   Mes del reporte en formato YYYY-MM (ej: "2026-02").
 *   Si se proporciona, filtra tanto los payouts de Airbnb como los depósitos
 *   bancarios al mes calendario exacto (sin ventana de días adicionales).
 *   Si es null, se usa el reportMonth de airbnbData (si existe).
 *
 * @returns {Object} Resultado estructurado con matched, onlyInAirbnb, onlyInBank,
 *                   differences y totales
 */
function compareTransactions(airbnbData, bankData, reportMonth = null) {
  // ── Normalizar entradas ────────────────────────────────────────

  // Extraer array de Payouts de Airbnb
  const payouts = Array.isArray(airbnbData)
    ? airbnbData                       // compatibilidad legado
    : (airbnbData.payouts || []);

  // Extraer depósitos bancarios de Airbnb de ambos PDFs y combinarlos
  let bankPdf1, bankPdf2, allBankDeposits;

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

  // Validar formato YYYY-MM antes de aplicar filtros.
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const mesValido = mesActivo && MONTH_RE.test(mesActivo);

  if (!mesValido && mesActivo) {
    console.error('[comparator] reportMonth inválido, se ignorará el filtro:', mesActivo);
  }

  console.log('[comparator] reportMonth activo:', mesActivo, '| válido:', mesValido);
  console.log('[comparator] Total payouts Airbnb:', payouts.length);
  console.log('[comparator] Total depósitos bancarios combinados:', allBankDeposits.length);

  // ── Filtrar payouts al mes activo (filtro estricto por mes calendario) ──
  // Cuando reportMonth es válido: solo payouts cuya fecha esté en ese mes.
  // Cuando es null o inválido: usar todos los payouts (fallback sin filtro).
  const payoutsActivos = mesValido
    ? payouts.filter(p => p.date && p.date.startsWith(mesActivo))
    : payouts;

  // ── Filtrar depósitos bancarios al mes activo (filtro estricto) ──────────
  // Sin ventana de ±7 días: dep.date debe comenzar con YYYY-MM exactamente.
  // Cuando es null o inválido: usar todos los depósitos (fallback sin filtro).
  const depositosFiltrados = mesValido
    ? allBankDeposits.filter(dep => {
        const fechaDep = dep.date || dep.liquidationDate || '';
        return fechaDep.startsWith(mesActivo);
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
  const bankDepositsInMonth = depositosFiltrados.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
  const otherBankMovements  = allBankDeposits
    .filter(dep => !depositosFiltrados.includes(dep))
    .reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  // Propagar mes activo final (null si era inválido)
  const mesActivoFinal = mesValido ? mesActivo : null;

  // ── Algoritmo de cruce (usa conjuntos filtrados) ───────────────
  // Para cada Payout activo:
  //   1. Buscar depósitos con monto igual (±AMOUNT_TOLERANCE), aún no usados
  //   2. Si hay varios candidatos, elegir el más cercano en fecha
  //   3. Marcar el depósito elegido como usado para evitar duplicados

  const matched      = [];
  const onlyInAirbnb = [];
  const usedBankIdx  = new Set();

  for (const payout of payoutsActivos) {
    const payoutDate = new Date(payout.date);

    const candidatos = depositosFiltrados
      .map((dep, idx) => ({ dep, idx }))
      .filter(({ dep, idx }) => {
        if (usedBankIdx.has(idx)) return false;
        return Math.abs((dep.amount || 0) - payout.amount) <= AMOUNT_TOLERANCE;
      });

    if (candidatos.length === 0) {
      onlyInAirbnb.push(payout);
      continue;
    }

    // Elegir el más cercano en fecha
    const mejor = candidatos.reduce((prev, curr) => {
      const dP = Math.abs(payoutDate - new Date(prev.dep.date || prev.dep.liquidationDate || ''));
      const dC = Math.abs(payoutDate - new Date(curr.dep.date || curr.dep.liquidationDate || ''));
      return dC < dP ? curr : prev;
    });

    usedBankIdx.add(mejor.idx);

    const depDate    = new Date(mejor.dep.date || mejor.dep.liquidationDate || '');
    const daysDiff   = Math.round((depDate - payoutDate) / (1000 * 60 * 60 * 24));
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
  const onlyInBank = depositosFiltrados.filter((_, idx) => !usedBankIdx.has(idx));
  console.log(`[comparator] onlyInBank final: ${onlyInBank.length}`);

  // ── Diferencias: matches con discrepancia de monto ────────────
  // Subconjunto de matched donde el monto Airbnb ≠ monto banco
  const differences = matched.filter(m => Math.abs(m.amountDifference) > 0);

  // ── Calcular totales ───────────────────────────────────────────
  const totalAirbnbPayouts = payoutsActivos.reduce((s, p) => s + (p.amount || 0), 0);
  const totalBankDeposits  = depositosFiltrados.reduce((s, d) => s + (d.amount || 0), 0);
  const difference         = Math.round((totalAirbnbPayouts - totalBankDeposits) * 100) / 100;
  const netDifference      = difference; // alias semántico

  // Total de depósitos SPEI de TODOS los PDFs bancarios, sin ningún filtro de mes.
  // Permite mostrar el acumulado global aunque el reporte filtre solo un mes.
  const bankAllMonths      = allBankDeposits.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
  const bankAllMonthsCount = allBankDeposits.length;

  const avgDays = matched.length > 0
    ? matched.reduce((s, m) => s + m.daysDifference, 0) / matched.length
    : 0;

  console.log(`[comparator] matched: ${matched.length} | onlyInAirbnb: ${onlyInAirbnb.length} | onlyInBank: ${onlyInBank.length} | differences: ${differences.length}`);
  console.log(`[comparator] totalAirbnbPayouts: ${totalAirbnbPayouts.toFixed(2)} | totalBankDeposits: ${totalBankDeposits.toFixed(2)} | netDifference: ${netDifference.toFixed(2)}`);

  // Períodos combinados
  const bankPeriod = combinePeriods(
    bankData.bankPdf1 ? bankData.bankPdf1.period : null,
    bankData.bankPdf2 ? bankData.bankPdf2.period : null,
  );
  const airbnbPeriod = airbnbData.period || null;

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
      bankAllMonths:        Math.round(bankAllMonths      * 100) / 100,
      bankAllMonthsCount,
    },
    periods: {
      airbnb: airbnbPeriod,
      bank:   bankPeriod,
    },
    reportMonth:  mesActivoFinal,
    reportLabel:  airbnbData.reportLabel || mesActivoFinal || 'Reporte',
    sourceSummary: {
      bankPdf1Count: bankPdf1.length,
      bankPdf2Count: bankPdf2.length,
    },
  };
}

// ── Helpers privados ───────────────────────────────────────────

function calcMatchRate(matched, total) {
  if (total === 0) return '0%';
  return `${Math.round((matched / total) * 100)}%`;
}

/**
 * combinePeriods — Combina dos períodos { from, to } en el rango total
 */
function combinePeriods(p1, p2) {
  if (!p1 && !p2) return null;
  if (!p1) return p2;
  if (!p2) return p1;
  const from = p1.from < p2.from ? p1.from : p2.from;
  const to   = p1.to   > p2.to   ? p1.to   : p2.to;
  return { from, to };
}

module.exports = { compareTransactions };
