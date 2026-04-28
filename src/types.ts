// types.ts — Interfaces TypeScript para los tipos core del dominio
// Fase 1 de la migración incremental JS → TS.
// Los archivos .js existentes siguen sin cambios (allowJs: true, checkJs: false).
// Estas interfaces se importarán progresivamente en los nuevos archivos .ts.

// ── Airbnb CSV ─────────────────────────────────────────────────

/** Una reservación individual extraída del CSV de Airbnb */
export interface Reservation {
  confirmationCode: string;
  guest:            string;
  property:         string;
  checkIn:          string | null;   // YYYY-MM-DD
  checkOut:         string | null;   // YYYY-MM-DD
  nights:           number;
  grossAmount:      number;          // Ingresos brutos
  serviceFee:       number;          // Tarifa de servicio Airbnb
  cleaningFee:      number;          // Tarifa de limpieza
  netAmount:        number;          // Monto neto recibido
}

/** Retenciones fiscales asociadas a un Payout */
export interface TaxWithholdings {
  isr:     number;   // Retención ISR (4%)
  iva:     number;   // Retención IVA (8%)
  hostTax: number;   // Impuestos liquidados como anfitrión
}

/** Un pago de Airbnb con sus reservaciones asociadas */
export interface AirbnbPayout {
  date:                string;          // YYYY-MM-DD
  expectedDepositDate: string | null;
  amount:              number;          // Monto neto del payout
  currency:            string;          // "MXN"
  referenceCode:       string;
  reservations:        Reservation[];
  taxWithholdings:     TaxWithholdings;
  source:              string;          // "airbnb_csv" | "airbnb_pdf_stub"
}

/** Resultado completo de parseAirbnbCSV / parseAirbnbPDF */
export interface AirbnbParseResult {
  payouts:      AirbnbPayout[];
  period:       DateRange | null;
  totalAmount:  number;
  reportMonth:  string | null;     // "YYYY-MM"
  reportLabel:  string;            // "Febrero 2026"
  source:       string;
}

// ── Banco BBVA ─────────────────────────────────────────────────

/** Un movimiento del estado de cuenta BBVA (abono o cargo) */
export interface BankDeposit {
  date:            string;              // YYYY-MM-DD
  liquidationDate: string;              // YYYY-MM-DD
  description:     string;
  reference:       string;
  amount:          number;
  type:            'abono' | 'cargo';
  currency:        string;              // "MXN"
  source:          string;              // "bbva_pdf"
}

/** Resultado completo de parseBankPDF */
export interface BankParseResult {
  period:         DateRange | null;
  accountNumber:  string;
  openingBalance: number;
  closingBalance: number;
  totalDeposits:  number;
  airbnbDeposits: BankDeposit[];
  allDeposits:    BankDeposit[];
  source:         string;              // "bbva_pdf"
}

// ── Comparador ─────────────────────────────────────────────────

/** Par coincidente: un Payout de Airbnb cruzado con un depósito bancario */
export interface MatchedTransaction {
  airbnbPayout: {
    date:          string;
    amount:        number;
    currency:      string;
    referenceCode: string;
    reservations:  Reservation[];
  };
  bankDeposit: {
    date:        string | undefined;
    amount:      number | undefined;
    description: string;
    reference:   string;
  };
  daysDifference:   number;
  amountDifference: number;
  status:           'matched' | 'matched_with_diff';
}

/** Totales calculados por el comparador */
export interface ReconciliationTotals {
  totalAirbnbPayouts:   number;
  totalBankDeposits:    number;
  bankDepositsInMonth:  number;
  otherBankMovements:   number;
  difference:           number;
  netDifference:        number;
  matchRate:            string;    // "85%"
  averageDaysToDeposit: number;
  bankAllMonths:        number;
  bankAllMonthsCount:   number;
}

/** Resultado completo de compareTransactions */
export interface ReconciliationResult {
  matched:      MatchedTransaction[];
  onlyInAirbnb: AirbnbPayout[];
  onlyInBank:   BankDeposit[];
  differences:  MatchedTransaction[];
  totals:       ReconciliationTotals;
  periods: {
    airbnb: DateRange | null;
    bank:   DateRange | null;
  };
  reportMonth:   string | null;
  reportLabel:   string;
  sourceSummary: {
    bankPdf1Count: number;
    bankPdf2Count: number;
  };
}

// ── Reporte ────────────────────────────────────────────────────

/** Resumen de totales almacenado en la base de datos */
export interface ReportSummary {
  totalAirbnbPayouts: number;
  totalBankDeposits:  number;
  netDifference:      number;
  matchRate:          string;
  reportMonth:        string;      // "YYYY-MM"
  reportLabel:        string;      // "Febrero 2026"
  cachedAnalysis?:    string;      // Texto de Claude (opcional, se cachea post-generación)
  cachedAnalysisAt?:  string;      // ISO timestamp del caché
}

// ── Utilidades compartidas ──────────────────────────────────────

/** Rango de fechas genérico usado en períodos de parsers y comparador */
export interface DateRange {
  from: string;   // YYYY-MM-DD
  to:   string;   // YYYY-MM-DD
}
