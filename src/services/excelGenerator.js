'use strict';

// excelGenerator.js — Genera el reporte mensual de ingresos en formato .xlsx
// Hoja 1: Reporte Mensual (28–31 filas por día)
// Hoja 2: Comparativa Banco (matched, pendientes, sin registro)
// Hoja 3: Comparativa Año Anterior (vs. reporte guardado en DB)

const ExcelJS = require('exceljs');

// ── Paleta de colores (ARGB) ──────────────────────────────────
const C = {
  DARK_BLUE:    'FF1F4E79',
  MID_BLUE:     'FF2E75B6',
  LIGHT_BLUE:   'FFBDD7EE',
  PALE_BLUE:    'FFDEEAF1',
  WHITE:        'FFFFFFFF',
  YELLOW:       'FFFFF2CC',
  GREEN_LIGHT:  'FFE2EFDA',
  RED_LIGHT:    'FFFCE4D6',
  FONT_WHITE:   'FFFFFFFF',
  FONT_DARK:    'FF000000',
  BORDER_DARK:  'FF1F4E79',
  BORDER_LIGHT: 'FF9DC3E6',
};

const MONTH_NAMES_ES = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo',      '04': 'Abril',
  '05': 'Mayo',  '06': 'Junio',   '07': 'Julio',      '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
};

// Anchos de columna A–T (20 columnas)
const COL_WIDTHS = [5, 7, 8, 6, 7, 10, 10, 9, 9, 12, 10, 12, 15, 9, 7, 10, 12, 13, 9, 8];
const NUM_FMT = '#,##0.00';

// ── Helpers de estilo ─────────────────────────────────────────

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function mkFont(bold, size, colorArgb = C.FONT_DARK) {
  return { name: 'Arial', size, bold, color: { argb: colorArgb } };
}

function mkBorder(style, colorArgb) {
  const b = { style, color: { argb: colorArgb } };
  return { top: b, bottom: b, left: b, right: b };
}

function hAlign(h) {
  return { horizontal: h, vertical: 'middle', wrapText: false };
}

function colLetter(n) {
  // 1-based, works for columns 1–26
  return String.fromCharCode(64 + n);
}

function setCell(ws, row, col, value, fnt, fill, bdr, align, numFmt) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  if (fnt)    cell.font      = fnt;
  if (fill)   cell.fill      = fill;
  if (bdr)    cell.border    = bdr;
  if (align)  cell.alignment = align;
  if (numFmt) cell.numFmt    = numFmt;
}

function setCellFml(ws, row, col, formula, fnt, fill, bdr, align, numFmt) {
  const cell = ws.getCell(row, col);
  cell.value = { formula };
  if (fnt)    cell.font      = fnt;
  if (fill)   cell.fill      = fill;
  if (bdr)    cell.border    = bdr;
  if (align)  cell.alignment = align;
  if (numFmt) cell.numFmt    = numFmt;
}

// ── Helpers de datos ──────────────────────────────────────────

function diasEnMes(reportMonth) {
  if (!reportMonth) return 31;
  const [year, month] = reportMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/**
 * buildDiasData — Construye un mapa { diaNumero → datos } a partir de los payouts.
 *
 * El día se determina por la fecha del PAYOUT (no por res.checkIn), porque el check-in
 * puede pertenecer al mes anterior (ej: check-in 31 enero → payout 1 febrero).
 * Cada payout es un SPEI; su monto (pagado) se asigna al día del payout directamente.
 *
 * F = tarifaTotal − limpieza  (grossAmount − cleaningFee: incluye huéspedes adicionales
 *     ya que el CSV no separa tarifa base de huéspedes adicionales)
 */
function buildDiasData(airbnbData, reportMonth) {
  const diasData = {};

  for (const payout of (airbnbData.payouts || [])) {
    if (!payout.date) continue;

    // Filtrar payouts al mes del reporte
    const payoutMonth = payout.date.substring(0, 7);
    if (reportMonth && payoutMonth !== reportMonth) continue;

    const dia = parseInt(payout.date.split('-')[2], 10);
    if (!dia || dia < 1 || dia > 31) continue;

    if (!diasData[dia]) {
      diasData[dia] = { noches: 0, tarifaTotal: 0, limpieza: 0,
                        comisionAirbnb: 0, pagado: 0,
                        crossType: null, nightsPrevMonth: 0,
                        nightsNextMonth: 0, nightsCurrMonth: 0,
                        checkIn: null, checkOut: null };
    }

    const d          = diasData[dia];
    const msPerDay   = 1000 * 60 * 60 * 24;

    for (const res of (payout.reservations || [])) {
      d.noches         += (parseInt(res.nights,  10) || 0);
      d.tarifaTotal    += (parseFloat(res.grossAmount)  || 0);
      d.limpieza       += (parseFloat(res.cleaningFee)  || 0);
      d.comisionAirbnb += Math.abs(parseFloat(res.serviceFee) || 0);

      // ── Detectar desfase de fechas entre meses ────────────
      if (reportMonth && res.checkIn && res.checkOut) {
        const checkInMonth  = res.checkIn.substring(0, 7);
        const checkOutMonth = res.checkOut.substring(0, 7);

        // Caso A: check-in en mes anterior
        let nightsPrev = 0;
        if (checkInMonth < reportMonth) {
          const checkInDate = new Date(res.checkIn  + 'T12:00:00');
          const monthStart  = new Date(reportMonth  + '-01T12:00:00');
          nightsPrev = Math.round((monthStart - checkInDate) / msPerDay);
          nightsPrev = Math.max(0, Math.min(nightsPrev, parseInt(res.nights, 10) || 0));
        }

        // Caso B: check-out en mes siguiente
        let nightsNext = 0;
        if (checkOutMonth > reportMonth) {
          const [yr, mo]     = reportMonth.split('-').map(Number);
          const monthEnd     = new Date(yr, mo, 0, 12, 0, 0);
          const checkOutDate = new Date(res.checkOut + 'T12:00:00');
          nightsNext = Math.round((checkOutDate - monthEnd) / msPerDay) - 1;
          nightsNext = Math.max(0, Math.min(nightsNext, parseInt(res.nights, 10) || 0));
        }

        if (nightsPrev > 0 || nightsNext > 0) {
          const nights = parseInt(res.nights, 10) || 0;
          d.crossType       = nightsPrev > 0 && nightsNext > 0 ? 'both'
                            : nightsPrev > 0 ? 'prev' : 'next';
          d.nightsPrevMonth = nightsPrev;
          d.nightsNextMonth = nightsNext;
          d.nightsCurrMonth = nights - nightsPrev - nightsNext;
          d.checkIn         = res.checkIn;
          d.checkOut        = res.checkOut;
        }
      }
    }

    // Un SPEI por payout — asignar el monto directamente (sobrescribir si el mismo
    // día tuviera dos payouts, lo cual no ocurre en la práctica)
    d.pagado = parseFloat(payout.amount) || 0;
  }

  return diasData;
}

// ── Sheet 1: Reporte Mensual ──────────────────────────────────

function buildSheet1(wb, airbnbData, compareResult, previousYearReport) {
  // ── Nueva distribución: 15 columnas (A–O) ─────────────────
  // A: Día  B: Noches  C: Tarifa  D: Limpieza  E: Total
  // F: IVA 0.16  G: TOTAL+IVA  H: Comisión Airbnb
  // I: IVA 8%  J: ISR 4%  K: Total Deduc.  L: PAGADO
  // M: Comisión(comprobación)  N: 0.080(tasa)  O: 0.040(tasa)

  const ws = wb.addWorksheet('Reporte Mensual');

  const reportMonth = airbnbData.reportMonth || compareResult.reportMonth || null;
  const reportLabel = airbnbData.reportLabel || compareResult.reportLabel || 'Reporte';
  const dias        = diasEnMes(reportMonth);
  const diasData    = buildDiasData(airbnbData, reportMonth);

  // Anchos de las 15 columnas
  const widths = [5, 7, 12, 10, 12, 10, 13, 15, 9, 7, 10, 12, 13, 9, 8];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const LAST_COL    = 15;   // columna O
  const headerFill  = solidFill(C.MID_BLUE);
  const darkFill    = solidFill(C.DARK_BLUE);
  const headerFont  = mkFont(true,  10, C.FONT_WHITE);
  const dataFont    = mkFont(false,  9, C.FONT_DARK);
  const boldData    = mkFont(true,   9, C.FONT_DARK);
  const thinBdr     = mkBorder('thin',   C.BORDER_LIGHT);
  const medBdr      = mkBorder('medium', C.BORDER_DARK);
  const centerAlign = hAlign('center');
  const rightAlign  = hAlign('right');

  // ── Fila 1: Título ─────────────────────────────────────────
  ws.mergeCells(1, 1, 1, LAST_COL);
  const r1 = ws.getCell('A1');
  r1.value = 'REPORTE MENSUAL DE INGRESOS';
  r1.font  = mkFont(true, 13, C.FONT_WHITE);
  r1.fill  = darkFill;
  r1.alignment = centerAlign;
  ws.getRow(1).height = 22;

  // ── Fila 2: Fecha de corte ─────────────────────────────────
  ws.mergeCells(2, 1, 2, LAST_COL);
  const r2 = ws.getCell('A2');
  r2.value = `Fecha de corte: ${reportLabel}`;
  r2.font  = mkFont(false, 10, C.FONT_WHITE);
  r2.fill  = darkFill;
  r2.alignment = centerAlign;
  ws.getRow(2).height = 16;

  // ── Fila 3: Encabezados de grupo ───────────────────────────
  // A(1): POLÍGONO | B(2): OCUPACIÓN | C–D(3–4): INGRESOS
  // E–G(5–7): IVA | H–K(8–11): DEDUCCIONES | L(12): TOTAL | M–O(13–15): COMPROBACIÓN
  function setGroupHeader(c1, c2, label) {
    if (c1 !== c2) ws.mergeCells(3, c1, 3, c2);
    const cell = ws.getCell(3, c1);
    cell.value = label; cell.fill = headerFill;
    cell.font = headerFont; cell.alignment = centerAlign;
  }
  setGroupHeader(1,  1,  'POLÍGONO');
  setGroupHeader(2,  2,  'OCUPACIÓN');
  setGroupHeader(3,  4,  'INGRESOS');
  setGroupHeader(5,  7,  'IVA');
  setGroupHeader(8,  11, 'DEDUCCIONES');
  setGroupHeader(12, 12, 'TOTAL');
  setGroupHeader(13, 15, 'COMPROBACIÓN');
  ws.getRow(3).height = 15;

  // ── Fila 4: Sub-encabezados (N4=0.080, O4=0.040) ──────────
  // N4 y O4 son valores numéricos que las fórmulas I y J referencian con $N$4 y $O$4
  const subHeaders = [
    'Día','Noches','Tarifa','Limpieza','Total',
    '0.16','TOTAL+IVA','Comisión Airbnb','IVA 8%','ISR 4%','Total Deduc.',
    'PAGADO','Comisión','0.080','0.040',
  ];
  subHeaders.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.fill      = headerFill;
    cell.font      = headerFont;
    cell.alignment = centerAlign;
    if (i === 13)      { cell.value = 0.080; cell.numFmt = '0.000'; }  // N4 — tasa IVA 8%
    else if (i === 14) { cell.value = 0.040; cell.numFmt = '0.000'; }  // O4 — tasa ISR 4%
    else               { cell.value = h; }
  });
  ws.getRow(4).height = 15;

  // Freeze en B5
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];

  // ── Filas de datos ─────────────────────────────────────────
  const dataStart   = 5;
  const dataEnd     = dataStart + dias - 1;
  const firstDataDay = Array.from({ length: dias }, (_, i) => i + 1).find(d => diasData[d]);
  const firstDataRow = firstDataDay ? (dataStart + firstDataDay - 1) : null;

  for (let d = 1; d <= dias; d++) {
    const r    = dataStart + d - 1;
    const data = diasData[d];
    const fill = data
      ? (d % 2 === 1 ? solidFill(C.PALE_BLUE) : solidFill(C.WHITE))
      : solidFill(C.WHITE);

    ws.getRow(r).height = 14;

    // A(1): día
    setCell(ws, r, 1, d, dataFont, fill, thinBdr, centerAlign);

    // B(2): noches
    setCell(ws, r, 2, data ? data.noches : 0, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // ── Indicador visual de desfase de fechas (celdas A y B) ──
    if (data?.crossType) {
      const crossColors = { prev: 'FFFFF2CC', next: 'FFE8F5E9', both: 'FFFCE4EC' };
      const crossFill   = solidFill(crossColors[data.crossType]);
      ws.getCell(r, 1).fill = crossFill;
      ws.getCell(r, 2).fill = crossFill;

      let noteText = '';
      if (data.crossType === 'prev') {
        noteText = `${data.nightsPrevMonth} noche(s) pertenecen al mes anterior\nCheck-in: ${data.checkIn}`;
      } else if (data.crossType === 'next') {
        noteText = `${data.nightsNextMonth} noche(s) pertenecen al mes siguiente\nCheck-out: ${data.checkOut}`;
      } else {
        noteText = `${data.nightsPrevMonth} noche(s) del mes anterior\n` +
                   `${data.nightsNextMonth} noche(s) del mes siguiente\n` +
                   `Check-in: ${data.checkIn} | Check-out: ${data.checkOut}`;
      }
      ws.getCell(r, 2).note = { texts: [{ font: { size: 9, name: 'Arial' }, text: noteText }] };
    }

    // C(3): tarifa = grossAmount − cleaningFee (incluye huéspedes adicionales)
    const tarifa = data ? (data.tarifaTotal - data.limpieza) : 0;
    setCell(ws, r, 3, tarifa, dataFont, fill, thinBdr, rightAlign, NUM_FMT);
    if (r === firstDataRow) {
      ws.getCell(r, 3).note = 'Tarifa + huéspedes adicionales combinados (CSV no los separa)';
    }

    // D(4): limpieza
    setCell(ws, r, 4, data ? data.limpieza : 0, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // E(5): =C+D  (total de ingresos brutos)
    setCellFml(ws, r, 5, `C${r}+D${r}`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // F(6): =E*0.16  (IVA 16%)
    setCellFml(ws, r, 6, `E${r}*0.16`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // G(7): =E+F  (total con IVA)
    setCellFml(ws, r, 7, `E${r}+F${r}`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // H(8): comisión Airbnb (hardcodeado del CSV)
    setCell(ws, r, 8, data ? data.comisionAirbnb : 0, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // I(9): =E*$N$4  (IVA 8% — referencia absoluta a N4=0.080)
    setCellFml(ws, r, 9, `E${r}*$N$4`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // J(10): =E*$O$4  (ISR 4% — referencia absoluta a O4=0.040)
    setCellFml(ws, r, 10, `E${r}*$O$4`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // K(11): =SUM(H:J)  (total deducciones)
    setCellFml(ws, r, 11, `SUM(H${r}:J${r})`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // L(12): =G-K  (PAGADO = total con IVA − deducciones)
    setCellFml(ws, r, 12, `G${r}-K${r}`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // M(13): =E*3%+(E*3%)*16%  (comprobación comisión)
    setCellFml(ws, r, 13, `E${r}*3%+(E${r}*3%)*16%`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // N(14): =E*$N$4  (comprobación IVA 8%)
    setCellFml(ws, r, 14, `E${r}*$N$4`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);

    // O(15): =E*$O$4  (comprobación ISR 4%)
    setCellFml(ws, r, 15, `E${r}*$O$4`, dataFont, fill, thinBdr, rightAlign, NUM_FMT);
  }

  // ── Fila TOTAL ─────────────────────────────────────────────
  const tRow    = dataEnd + 1;
  const totFill = solidFill(C.LIGHT_BLUE);

  setCell(ws, tRow, 1, 'TOTAL', boldData, totFill, medBdr, centerAlign);
  for (let c = 2; c <= LAST_COL; c++) {
    const L = colLetter(c);
    setCellFml(ws, tRow, c, `SUM(${L}${dataStart}:${L}${dataEnd})`,
      boldData, totFill, medBdr, rightAlign, NUM_FMT);
  }
  ws.getRow(tRow).height = 16;

  // ── Filas de pie (fondo amarillo) ─────────────────────────
  const footFill = solidFill(C.YELLOW);
  const footFont = mkFont(false, 9, C.FONT_DARK);
  const footBold = mkFont(true,  9, C.FONT_DARK);

  function blankFooterRow(r) {
    for (let c = 1; c <= LAST_COL; c++) {
      setCell(ws, r, c, null, footFont, footFill, thinBdr, rightAlign);
    }
    ws.getRow(r).height = 14;
  }

  // PAGADAS: B=noches, C=C/E, D=D/E, E=1, H=comisión sin IVA, I=J=retenciones, K=K-I, L=L_total
  const pagR = tRow + 1; blankFooterRow(pagR);
  setCell(ws, pagR, 1, 'PAGADAS', footBold, footFill, thinBdr, centerAlign);
  setCellFml(ws, pagR, 2,  `B${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 3,  `IF(E${tRow}<>0,C${tRow}/E${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 4,  `IF(E${tRow}<>0,D${tRow}/E${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, pagR, 5, 1,  footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 8,  `H${tRow}/1.16`,        footBold, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 9,  `I${tRow}+J${tRow}`,    footBold, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 10, `I${tRow}+J${tRow}`,    footBold, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 11, `K${tRow}-I${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, pagR, 12, `L${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);

  // POC: B=noches/dias, C="C/IVA", E="Cálculo IVA", F=IVA16 total,
  //      H="SIN IVA", I=J="RETENCIONES IMPUESTOS", K="Diferencia", L=L-L_PAGADAS
  const pocR = tRow + 2; blankFooterRow(pocR);
  setCell(ws, pocR, 1, 'POC', footBold, footFill, thinBdr, centerAlign);
  setCellFml(ws, pocR, 2,  `IF(B${tRow}<>0,B${tRow}/${dias},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, pocR, 3,  'C/IVA',       footFont, footFill, thinBdr, centerAlign);
  setCell(ws, pocR, 5,  'Cálculo IVA', footFont, footFill, thinBdr, centerAlign);
  setCellFml(ws, pocR, 6,  `F${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, pocR, 8,  'SIN IVA',                footBold, footFill, thinBdr, centerAlign);
  setCell(ws, pocR, 9,  'RETENCIONES IMPUESTOS',  footBold, footFill, thinBdr, centerAlign);
  setCell(ws, pocR, 10, 'RETENCIONES IMPUESTOS',  footBold, footFill, thinBdr, centerAlign);
  setCell(ws, pocR, 11, 'Diferencia',  footFont, footFill, thinBdr, centerAlign);
  setCellFml(ws, pocR, 12, `L${tRow}-L${pagR}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);

  // TAP: B=E/B (tarifa por noche), C=G/B (con IVA), E="Retenido", F=I total,
  //      K=año anterior, L=total año anterior
  const tapR = tRow + 3; blankFooterRow(tapR);
  setCell(ws, tapR, 1, 'TAP', footBold, footFill, thinBdr, centerAlign);
  setCellFml(ws, tapR, 2,  `IF(B${tRow}<>0,E${tRow}/B${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, tapR, 3,  `IF(B${tRow}<>0,G${tRow}/B${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, tapR, 5,  'Retenido', footFont, footFill, thinBdr, centerAlign);
  setCellFml(ws, tapR, 6,  `I${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  const prevLabel = previousYearReport
    ? String(parseInt((reportMonth || '').substring(0, 4), 10) - 1)
    : 'Año anterior';
  setCell(ws, tapR, 11, prevLabel, footFont, footFill, thinBdr, centerAlign);
  setCell(ws, tapR, 12,
    previousYearReport?.summary?.totalAirbnbPayouts || 0,
    footFont, footFill, thinBdr, rightAlign, NUM_FMT);

  // TAPTO: B=C/B (tarifa/noches), C=G/B (con IVA), E="X acreditar",
  //        F=F-I (IVA16-IVA8), K="Diferencia", L=L_TAP-L_TOTAL
  const taptoR = tRow + 4; blankFooterRow(taptoR);
  setCell(ws, taptoR, 1, 'TAPTO', footBold, footFill, thinBdr, centerAlign);
  setCellFml(ws, taptoR, 2,  `IF(B${tRow}<>0,C${tRow}/B${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCellFml(ws, taptoR, 3,  `IF(B${tRow}<>0,G${tRow}/B${tRow},0)`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, taptoR, 5,  'X acreditar', footFont, footFill, thinBdr, centerAlign);
  setCellFml(ws, taptoR, 6,  `F${tRow}-I${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);
  setCell(ws, taptoR, 11, 'Diferencia', footFont, footFill, thinBdr, centerAlign);
  setCellFml(ws, taptoR, 12, `L${tapR}-L${tRow}`, footFont, footFill, thinBdr, rightAlign, NUM_FMT);

  // ── Leyenda de colores de desfase ─────────────────────────
  const legendStart = taptoR + 2;
  const leyendas = [
    { color: 'FFFFF2CC', texto: '  Noche(s) del mes anterior incluidas en esta reservación' },
    { color: 'FFE8F5E9', texto: '  Noche(s) del mes siguiente incluidas en esta reservación' },
    { color: 'FFFCE4EC', texto: '  Reservación que cruza mes anterior Y mes siguiente' },
  ];
  leyendas.forEach((l, i) => {
    const lr = legendStart + i;
    ws.getCell(lr, 1).fill  = solidFill(l.color);
    ws.getCell(lr, 1).value = '   ';
    ws.getRow(lr).height    = 13;
    ws.getCell(lr, 2).value = l.texto;
    ws.getCell(lr, 2).font  = { name: 'Arial', size: 8, italic: true };
    ws.mergeCells(lr, 2, lr, 7);
  });
}

// ── Sheet 2: Comparativa Banco ────────────────────────────────

function buildSheet2(wb, compareResult) {
  const ws = wb.addWorksheet('Comparativa Banco');

  const darkFill  = solidFill(C.DARK_BLUE);
  const midFill   = solidFill(C.MID_BLUE);
  const paleFill  = solidFill(C.PALE_BLUE);
  const whiteFill = solidFill(C.WHITE);
  const thinBdr   = mkBorder('thin', C.BORDER_LIGHT);

  // Anchos
  [20, 20, 30, 16, 16, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const { matched = [], onlyInAirbnb = [], onlyInBank = [], totals = {} } = compareResult;

  let currentRow = 1;

  // ── Sección 1: Resumen ──────────────────────────────────────
  ws.mergeCells(`A${currentRow}:G${currentRow}`);
  setCell(ws, currentRow, 1, 'RESUMEN COMPARATIVA', mkFont(true, 12, C.FONT_WHITE), darkFill, null, hAlign('center'));
  currentRow++;

  const summaryItems = [
    ['Total Airbnb Payouts',     totals.totalAirbnbPayouts || 0, NUM_FMT],
    ['Total Depósitos Banco',    totals.totalBankDeposits  || 0, NUM_FMT],
    ['Diferencia Neta',          totals.difference         || 0, NUM_FMT],
    ['Match Rate',               totals.matchRate          || '0%', null],
    ['Promedio días al depósito',totals.averageDaysToDeposit || 0, '0.0'],
  ];

  for (const [label, value, fmt] of summaryItems) {
    setCell(ws, currentRow, 1, label, mkFont(true, 10, C.FONT_WHITE), midFill, thinBdr, hAlign('left'));
    ws.mergeCells(currentRow, 1, currentRow, 4);
    setCell(ws, currentRow, 5, value, mkFont(true, 11, C.FONT_DARK), paleFill, thinBdr, hAlign('right'), fmt || undefined);
    ws.mergeCells(currentRow, 5, currentRow, 7);
    currentRow++;
  }

  currentRow++; // espacio

  // ── Sección 2: Coincidentes ─────────────────────────────────
  ws.mergeCells(`A${currentRow}:G${currentRow}`);
  setCell(ws, currentRow, 1, `TRANSACCIONES COINCIDENTES (${matched.length})`,
    mkFont(true, 11, C.FONT_WHITE), darkFill, null, hAlign('center'));
  currentRow++;

  const hdr2 = ['Fecha Airbnb','Fecha Banco','Descripción','Monto Airbnb','Monto Banco','Diferencia','Días al dep.'];
  hdr2.forEach((h, i) => {
    setCell(ws, currentRow, i + 1, h, mkFont(true, 9, C.FONT_WHITE), midFill, thinBdr,
      hAlign(i < 3 ? 'center' : 'right'));
  });
  currentRow++;

  let sumAirbnb = 0, sumBank = 0, sumDiff = 0;
  for (let i = 0; i < matched.length; i++) {
    const m    = matched[i];
    const fill = i % 2 === 0 ? paleFill : whiteFill;
    const ap   = m.airbnbPayout || m;
    const bd   = m.bankDeposit  || m;

    setCell(ws, currentRow, 1, ap.date           || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    setCell(ws, currentRow, 2, bd.date           || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    setCell(ws, currentRow, 3, bd.description    || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('left'));
    setCell(ws, currentRow, 4, ap.amount         || 0,  mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'), NUM_FMT);
    setCell(ws, currentRow, 5, bd.amount         || 0,  mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'), NUM_FMT);
    setCell(ws, currentRow, 6, m.amountDifference || 0, mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'), NUM_FMT);
    setCell(ws, currentRow, 7, m.daysDifference   || 0, mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'));

    sumAirbnb += ap.amount || 0;
    sumBank   += bd.amount || 0;
    sumDiff   += m.amountDifference || 0;
    currentRow++;
  }

  // Fila total de coincidentes
  const totFill = solidFill(C.LIGHT_BLUE);
  setCell(ws, currentRow, 1, 'TOTAL', mkFont(true, 9, C.FONT_DARK), totFill, thinBdr, hAlign('center'));
  ws.mergeCells(currentRow, 1, currentRow, 3);
  setCell(ws, currentRow, 4, sumAirbnb, mkFont(true, 9, C.FONT_DARK), totFill, thinBdr, hAlign('right'), NUM_FMT);
  setCell(ws, currentRow, 5, sumBank,   mkFont(true, 9, C.FONT_DARK), totFill, thinBdr, hAlign('right'), NUM_FMT);
  setCell(ws, currentRow, 6, sumDiff,   mkFont(true, 9, C.FONT_DARK), totFill, thinBdr, hAlign('right'), NUM_FMT);
  currentRow += 2;

  // ── Sección 3: Solo en Airbnb ───────────────────────────────
  ws.mergeCells(`A${currentRow}:G${currentRow}`);
  setCell(ws, currentRow, 1, `SOLO EN AIRBNB — PENDIENTES DE DEPÓSITO (${onlyInAirbnb.length})`,
    mkFont(true, 11, C.FONT_WHITE), darkFill, null, hAlign('center'));
  currentRow++;

  const hdr3 = ['Fecha','Monto','Código reserva','Estado'];
  hdr3.forEach((h, i) => {
    setCell(ws, currentRow, i + 1, h, mkFont(true, 9, C.FONT_WHITE), midFill, thinBdr, hAlign(i > 0 ? 'right' : 'center'));
  });
  currentRow++;

  for (let i = 0; i < onlyInAirbnb.length; i++) {
    const p    = onlyInAirbnb[i];
    const fill = i % 2 === 0 ? paleFill : whiteFill;
    setCell(ws, currentRow, 1, p.date          || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    setCell(ws, currentRow, 2, p.amount        || 0,  mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'), NUM_FMT);
    setCell(ws, currentRow, 3, p.referenceCode || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('left'));
    setCell(ws, currentRow, 4, 'Pendiente',           mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    currentRow++;
  }
  currentRow++;

  // ── Sección 4: Solo en banco ────────────────────────────────
  ws.mergeCells(`A${currentRow}:G${currentRow}`);
  setCell(ws, currentRow, 1, `SOLO EN BANCO — SIN REGISTRO AIRBNB (${onlyInBank.length})`,
    mkFont(true, 11, C.FONT_WHITE), darkFill, null, hAlign('center'));
  currentRow++;

  const hdr4 = ['Fecha','Monto','Descripción','Estado'];
  hdr4.forEach((h, i) => {
    setCell(ws, currentRow, i + 1, h, mkFont(true, 9, C.FONT_WHITE), midFill, thinBdr, hAlign(i > 0 ? 'right' : 'center'));
  });
  currentRow++;

  for (let i = 0; i < onlyInBank.length; i++) {
    const dep  = onlyInBank[i];
    const fill = i % 2 === 0 ? paleFill : whiteFill;
    setCell(ws, currentRow, 1, dep.date        || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    setCell(ws, currentRow, 2, dep.amount      || 0,  mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('right'), NUM_FMT);
    setCell(ws, currentRow, 3, dep.description || '', mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('left'));
    setCell(ws, currentRow, 4, 'Sin registro',        mkFont(false, 9, C.FONT_DARK), fill, thinBdr, hAlign('center'));
    currentRow++;
  }
}

// ── Sheet 3: Comparativa Año Anterior ────────────────────────

function buildSheet3(wb, compareResult, previousYearReport, airbnbData) {
  const ws = wb.addWorksheet('Comparativa Año Anterior');

  const reportMonth = compareResult.reportMonth || airbnbData.reportMonth || null;
  const reportLabel = compareResult.reportLabel || airbnbData.reportLabel || 'Reporte';
  const [year]      = (reportMonth || '').split('-');
  const prevYear    = year ? String(parseInt(year, 10) - 1) : null;
  const monthName   = reportMonth ? (MONTH_NAMES_ES[reportMonth.split('-')[1]] || '') : '';

  // Anchos
  [28, 16, 16, 16, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const darkFill = solidFill(C.DARK_BLUE);
  const midFill  = solidFill(C.MID_BLUE);
  const thinBdr  = mkBorder('thin', C.BORDER_LIGHT);

  // Título
  ws.mergeCells('A1:E1');
  setCell(ws, 1, 1, 'COMPARATIVA AÑO ANTERIOR', mkFont(true, 12, C.FONT_WHITE), darkFill, null, hAlign('center'));

  // Fallback defensivo: si compareResult o airbnbData llevan prevYearData inyectado
  // (por ejemplo cuando generateExcel no pudo leerlo de la DB pero lo tiene en el store)
  if (!previousYearReport) {
    const pvd = compareResult?.prevYearData || airbnbData?.prevYearData;
    if (pvd) {
      previousYearReport = {
        summary: {
          totalAirbnbPayouts: pvd.totalAirbnbPayouts || 0,
          totalBankDeposits:  pvd.totalBankDeposits  || 0,
          matchRate:          pvd.matchRate           || '0%',
          payoutsCount:       pvd.payoutsCount        || 0,
          matchedCount:       pvd.matchedCount        || 0,
          onlyAirbnbCount:    pvd.onlyAirbnbCount     || 0,
          onlyBankCount:      pvd.onlyBankCount       || 0,
        },
        excelData: { noches: pvd.noches || 0 },
      };
    }
  }

  if (!previousYearReport) {
    // Sin datos del año anterior
    ws.mergeCells('A3:E3');
    setCell(ws, 3, 1,
      `No hay reporte del año anterior disponible para ${monthName} ${prevYear || ''}`,
      mkFont(false, 11, C.FONT_DARK), null, null, hAlign('center'));

    ws.mergeCells('A4:E4');
    setCell(ws, 4, 1,
      `Guarda el reporte de ${monthName} ${prevYear || ''} para habilitar esta comparación`,
      mkFont(false, 10, C.FONT_DARK), solidFill(C.YELLOW), null, hAlign('center'));
    return;
  }

  // Encabezados de tabla
  const headers = ['Concepto', `${monthName} ${prevYear}`, `${monthName} ${year}`, 'Diferencia', 'Variación %'];
  headers.forEach((h, i) => {
    setCell(ws, 2, i + 1, h, mkFont(true, 10, C.FONT_WHITE), midFill, thinBdr,
      hAlign(i === 0 ? 'left' : 'right'));
  });

  const prev = previousYearReport.summary || {};
  const curr = compareResult.totals       || {};

  const rows = [
    ['Ingresos brutos totales',   prev.totalAirbnbPayouts || 0,   curr.totalAirbnbPayouts || 0],
    ['Total depósitos banco',     prev.totalBankDeposits  || 0,   curr.totalBankDeposits  || 0],
    ['Diferencia neta',           prev.difference         || 0,   curr.difference         || 0],
    ['Payouts / Transacciones',   prev.payoutsCount       || 0,   (compareResult.matched || []).length + (compareResult.onlyInAirbnb || []).length],
    ['Match Rate',                prev.matchRate          || '0%', curr.matchRate         || '0%'],
    ['Promedio días al depósito', prev.averageDaysToDeposit || 0, curr.averageDaysToDeposit || 0],
    ['Total banco (todos meses)', prev.bankTotalAllMonths  || 0,  curr.bankAllMonths       || 0],
  ];

  const paleFill  = solidFill(C.PALE_BLUE);
  const whiteFill = solidFill(C.WHITE);

  rows.forEach(([concepto, prevVal, currVal], i) => {
    const fill = i % 2 === 0 ? paleFill : whiteFill;
    const r    = i + 3;
    const isStr = typeof prevVal === 'string' || typeof currVal === 'string';
    const diff  = isStr ? '' : (currVal - prevVal);
    const pct   = isStr || !prevVal ? '' : ((diff / Math.abs(prevVal)) * 100);

    setCell(ws, r, 1, concepto, mkFont(false, 10, C.FONT_DARK), fill, thinBdr, hAlign('left'));
    setCell(ws, r, 2, prevVal, mkFont(false, 10, C.FONT_DARK), fill, thinBdr, hAlign('right'), isStr ? undefined : NUM_FMT);
    setCell(ws, r, 3, currVal, mkFont(false, 10, C.FONT_DARK), fill, thinBdr, hAlign('right'), isStr ? undefined : NUM_FMT);

    if (isStr) {
      setCell(ws, r, 4, '', mkFont(false, 10, C.FONT_DARK), fill, thinBdr, hAlign('right'));
      setCell(ws, r, 5, '', mkFont(false, 10, C.FONT_DARK), fill, thinBdr, hAlign('right'));
    } else {
      const diffFill  = diff > 0 ? solidFill(C.GREEN_LIGHT) : diff < 0 ? solidFill(C.RED_LIGHT) : fill;
      const diffColor = diff > 0 ? 'FF1A6B3C' : diff < 0 ? 'FFC00000' : C.FONT_DARK;
      setCell(ws, r, 4, diff, mkFont(true, 10, diffColor), diffFill, thinBdr, hAlign('right'), NUM_FMT);
      setCell(ws, r, 5, pct !== '' ? pct / 100 : '', mkFont(true, 10, diffColor), diffFill, thinBdr, hAlign('right'), '0.00%');
    }
  });
}

// ── Función principal ─────────────────────────────────────────

/**
 * generateMonthlyReport — Genera el archivo .xlsx en memoria y devuelve un Buffer.
 * @param {Object} airbnbData         - Resultado de parseAirbnbCSV
 * @param {Object} compareResult      - Resultado de compareTransactions (sin formatear)
 * @param {Object|null} previousYearReport - Reporte del año anterior guardado en DB (o null)
 * @returns {Promise<Buffer>}
 */
// ── Sheet 4: Análisis IA ───────────────────────────────────────

/**
 * buildSheet4 — Escribe el análisis de IA en una hoja de Excel formateada.
 * @param {import('exceljs').Workbook} wb
 * @param {string} analysisText - Texto del análisis en formato Markdown sencillo
 */
function buildSheet4(wb, analysisText) {
  const ws = wb.addWorksheet('Análisis IA');
  ws.getColumn(1).width = 120;

  // Fila 1: título principal
  ws.mergeCells('A1:A1');
  const titleCell       = ws.getCell('A1');
  titleCell.value       = 'ANÁLISIS FINANCIERO GENERADO POR IA';
  titleCell.font        = { name: 'Arial', bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  titleCell.alignment   = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height   = 30;

  // Fila 2: fecha de generación
  const dateCell      = ws.getCell('A2');
  dateCell.value      = `Generado: ${new Date().toLocaleDateString('es-MX')} · Modelo: Claude (Anthropic)`;
  dateCell.font       = { name: 'Arial', italic: true, size: 9, color: { argb: 'FF6B7280' } };
  dateCell.alignment  = { horizontal: 'center' };
  ws.getRow(2).height = 14;

  // Fila 3: separador vacío
  ws.getRow(3).height = 6;

  // Parsear y escribir el análisis por secciones
  let currentRow = 4;
  const lines    = (analysisText || '').split('\n');

  lines.forEach(line => {
    if (line.startsWith('## ')) {
      // Encabezado de sección
      ws.getRow(currentRow).height    = 22;
      const cell                      = ws.getCell(`A${currentRow}`);
      cell.value                      = line.replace('## ', '');
      cell.font                       = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill                       = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
      cell.alignment                  = { vertical: 'middle', indent: 1 };
      currentRow++;
    } else if (line.trim()) {
      // Línea de contenido (texto o ítem de lista)
      const isListItem                = line.startsWith('- ');
      ws.getRow(currentRow).height    = line.length > 100 ? 28 : 15;
      const cell                      = ws.getCell(`A${currentRow}`);
      cell.value                      = line;
      cell.font                       = { name: 'Arial', size: 9 };
      cell.alignment                  = { wrapText: true, vertical: 'top', indent: isListItem ? 3 : 1 };
      currentRow++;
    } else if (currentRow > 4) {
      // Línea vacía como separador (solo si ya hay contenido)
      ws.getRow(currentRow).height    = 5;
      currentRow++;
    }
  });
}

/**
 * generateMonthlyReport — Genera el workbook mensual completo.
 * @param {Object}      airbnbData
 * @param {Object}      compareResult
 * @param {Object|null} previousYearReport
 * @param {string|null} analysisText - Opcional: texto del análisis IA para Hoja 4
 * @returns {Promise<Buffer>}
 */
async function generateMonthlyReport(airbnbData, compareResult, previousYearReport, analysisText) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Airbnb Finance Assistant';
  wb.created  = new Date();

  buildSheet1(wb, airbnbData, compareResult, previousYearReport);
  buildSheet2(wb, compareResult);
  buildSheet3(wb, compareResult, previousYearReport, airbnbData);

  if (analysisText) {
    buildSheet4(wb, analysisText);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

module.exports = { generateMonthlyReport };
