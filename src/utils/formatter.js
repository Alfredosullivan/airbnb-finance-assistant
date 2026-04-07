// formatter.js — Formateador del reporte final
// Transforma el resultado del comparator en el JSON estructurado que devuelve la API

/**
 * formatReport — Da forma al JSON de respuesta del endpoint GET /api/report
 * @param {Object} compareResult - Salida de comparator.compareTransactions
 * @returns {Object} Reporte estructurado listo para serializar como JSON
 */
function formatReport(compareResult) {
  const {
    matched, onlyInAirbnb, onlyInBank, differences,
    totals, periods, sourceSummary,
    reportMonth, reportLabel,
  } = compareResult;

  const {
    totalAirbnbPayouts, totalBankDeposits, difference, netDifference,
    bankDepositsInMonth, otherBankMovements,
    matchRate, averageDaysToDeposit,
    bankAllMonths, bankAllMonthsCount,
  } = totals || {};

  // ── Mappers de tablas ──────────────────────────────────────────

  const mappedMatched = (matched || []).map(m => ({
    airbnbDate:       m.airbnbPayout.date,
    bankDate:         m.bankDeposit.date,
    daysDifference:   m.daysDifference,
    airbnbAmount:     round(m.airbnbPayout.amount),
    bankAmount:       round(m.bankDeposit.amount),
    amountDifference: round(m.amountDifference),
    currency:         m.airbnbPayout.currency || 'MXN',
    referenceCode:    m.airbnbPayout.referenceCode,
    bankDescription:  m.bankDeposit.description,
    bankReference:    m.bankDeposit.reference,
    reservations:     m.airbnbPayout.reservations || [],
    status:           m.status,
  }));

  const mappedOnlyAirbnb = (onlyInAirbnb || []).map(p => ({
    date:          p.date,
    amount:        round(p.amount),
    currency:      p.currency || 'MXN',
    referenceCode: p.referenceCode || '',
    reservations:  p.reservations  || [],
    label:         'Pendiente',
  }));

  const mappedOnlyBank = (onlyInBank || []).map(d => ({
    date:        d.date,
    amount:      round(d.amount),
    currency:    d.currency || 'MXN',
    description: d.description || '',
    reference:   d.reference   || '',
    label:       'Sin registro',
  }));

  // Diferencias: matches con discrepancia de monto (reutiliza mappedMatched)
  const mappedDifferences = mappedMatched.filter(m => Math.abs(m.amountDifference) > 0);

  const netDiff = round(netDifference ?? difference);

  return {
    generatedAt: new Date().toISOString(),

    // Campos de identificación del reporte (usados para guardarlo en el historial)
    reportMonth: reportMonth || null,     // "2026-02" — clave en la DB
    reportLabel: reportLabel || 'Reporte', // "Febrero 2026" — etiqueta legible

    // ── Resumen ejecutivo ──────────────────────────────────────
    summary: {
      period: {
        airbnbMonth:     reportLabel || null,  // "Febrero 2026"
        airbnbFrom:      periods?.airbnb?.from || null,
        airbnbTo:        periods?.airbnb?.to   || null,
        bankFrom:        periods?.bank?.from   || null,
        bankTo:          periods?.bank?.to     || null,
      },
      // Alias convenientes para el frontend de guardado
      reportMonth: reportMonth || null,
      reportLabel: reportLabel || null,
      // Totales principales (compatibilidad con tests y frontend existente)
      totalAirbnbPayouts:   round(totalAirbnbPayouts),
      totalBankDeposits:    round(totalBankDeposits),
      difference:           round(difference),
      netDifference:        netDiff,
      matchRate:            matchRate || '0%',
      averageDaysToDeposit: averageDaysToDeposit || 0,
      status:               getStatus(difference),
      // Conteos
      payoutsCount:  (matched || []).length + (onlyInAirbnb || []).length,
      depositsCount: (matched || []).length + (onlyInBank   || []).length,
      // Total acumulado de depósitos SPEI de todos los PDFs bancarios (sin filtro de mes)
      bankTotalAllMonths:      round(bankAllMonths      ?? 0),
      bankTotalAllMonthsCount: bankAllMonthsCount       ?? 0,
      // Totales desglosados por mes
      totals: {
        airbnbPayouts:     round(totalAirbnbPayouts),   // etiqueta: "Total Airbnb"
        bankDepositsMonth: round(bankDepositsInMonth),  // etiqueta: "Depósitos del mes"
        bankDepositsTotal: round(bankDepositsInMonth + (otherBankMovements || 0)),
        difference:        round(difference),
        netDifference:     netDiff,
        matchRate:         matchRate || '0%',
      },
    },

    // ── Tablas de transacciones (estructura nueva para el frontend) ──
    tables: {
      matched:      mappedMatched,
      onlyInAirbnb: mappedOnlyAirbnb,
      onlyInBank:   mappedOnlyBank,
      differences:  mappedDifferences,
    },

    // ── Compatibilidad hacia atrás (también en top-level para los tests) ──
    matched:      mappedMatched,
    onlyInAirbnb: mappedOnlyAirbnb,
    onlyInBank:   mappedOnlyBank,
    differences:  mappedDifferences,

    // ── Desglose de fuentes bancarias ─────────────────────────
    bankSources: {
      pdf1Transactions:  sourceSummary?.bankPdf1Count || 0,
      pdf2Transactions:  sourceSummary?.bankPdf2Count || 0,
      totalTransactions: (sourceSummary?.bankPdf1Count || 0) + (sourceSummary?.bankPdf2Count || 0),
    },

    // ── Conteos crudos para debug ─────────────────────────────
    rawAirbnb: {
      payouts:     (onlyInAirbnb || []).length + (matched || []).length,
      totalAmount: round(totalAirbnbPayouts),
    },
    rawBank: {
      airbnbDeposits: (onlyInBank || []).length + (matched || []).length,
      totalAmount:    round(totalBankDeposits),
    },
  };
}

// ── Helpers privados ───────────────────────────────────────────

/** Redondea a 2 decimales para evitar errores de punto flotante */
function round(n) {
  if (n == null || isNaN(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Determina el estado general del reporte */
function getStatus(difference) {
  if (difference == null) return 'UNKNOWN';
  if (Math.abs(difference) < 0.01) return 'OK';
  return 'DISCREPANCY';
}

module.exports = { formatReport };
