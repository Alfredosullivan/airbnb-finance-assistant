'use strict';

// annualExcelGenerator.js — Genera el reporte anual consolidado en formato .xlsx
// Hoja 1: "Resumen Anual {year}" — tabla mensual + indicadores
// Hoja 2: "Gráfica Ingresos"    — tabla de datos lista para gráfica en Excel

const ExcelJS = require('exceljs');

// ── Paleta de colores (ARGB) ──────────────────────────────────
const C = {
  DARK_BLUE:  'FF1F4E79',
  MID_BLUE:   'FF2E75B6',
  LIGHT_BLUE: 'FFBDD7EE',
  PALE_BLUE:  'FFDEEAF1',
  WHITE:      'FFFFFFFF',
  YELLOW:     'FFFFF2CC',
  GREEN_BG:   'FFE8F5E9',
  FONT_WHITE: 'FFFFFFFF',
  FONT_DARK:  'FF000000',
  FONT_AMBER: 'FF92400E',
  FONT_GREEN: 'FF1A7A4A',
  FONT_RED:   'FFC00000',
  FONT_MUTED: 'FF717171',
  BORDER:     'FF9DC3E6',
};

const MONTH_NAMES_ES = {
  '01': 'Enero',     '02': 'Febrero',   '03': 'Marzo',
  '04': 'Abril',     '05': 'Mayo',      '06': 'Junio',
  '07': 'Julio',     '08': 'Agosto',    '09': 'Septiembre',
  '10': 'Octubre',   '11': 'Noviembre', '12': 'Diciembre',
};

const ALL_MONTHS  = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const NUM_FMT     = '#,##0.00';
const INT_FMT     = '#,##0';
const PCT_FMT     = '0.0%';
const NUM_COLS    = 12;   // columns A–L

// ── Helpers de estilo ─────────────────────────────────────────

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function mkFont(bold, size, colorArgb = C.FONT_DARK) {
  return { name: 'Arial', size: size || 10, bold, color: { argb: colorArgb } };
}

function thinBorder() {
  const b = { style: 'thin', color: { argb: C.BORDER } };
  return { top: b, bottom: b, left: b, right: b };
}

const aL = { horizontal: 'left',   vertical: 'middle' };
const aC = { horizontal: 'center', vertical: 'middle' };
const aR = { horizontal: 'right',  vertical: 'middle' };

/** Escribe un valor en una celda con estilos opcionales */
function sc(ws, row, col, value, opts = {}) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  if (opts.font)   cell.font      = opts.font;
  if (opts.fill)   cell.fill      = opts.fill;
  if (opts.border) cell.border    = opts.border;
  if (opts.align)  cell.alignment = opts.align;
  if (opts.numFmt) cell.numFmt    = opts.numFmt;
}

/** Escribe una fórmula en una celda con estilos opcionales */
function sf(ws, row, col, formula, opts = {}) {
  const cell = ws.getCell(row, col);
  cell.value = { formula };
  if (opts.font)   cell.font      = opts.font;
  if (opts.fill)   cell.fill      = opts.fill;
  if (opts.border) cell.border    = opts.border;
  if (opts.align)  cell.alignment = opts.align;
  if (opts.numFmt) cell.numFmt    = opts.numFmt;
}

/** Fusiona un rango y escribe un valor con estilos */
function mergeCell(ws, r1, c1, r2, c2, value, opts = {}) {
  ws.mergeCells(r1, c1, r2, c2);
  const cell = ws.getCell(r1, c1);
  cell.value = value;
  if (opts.font)   cell.font      = opts.font;
  if (opts.fill)   cell.fill      = opts.fill;
  if (opts.align)  cell.alignment = opts.align;
  if (opts.border) cell.border    = opts.border;
  if (opts.numFmt) cell.numFmt    = opts.numFmt;
}

/** Convierte "85%" → 0.85; devuelve null si no parseable */
function parseRate(rateStr) {
  if (!rateStr || rateStr === '—') return null;
  const n = parseFloat(rateStr);
  return isNaN(n) ? null : n / 100;
}

// ── Generador principal ───────────────────────────────────────

/**
 * generateAnnualReport — Genera el Excel anual consolidado
 * @param {Object} opts
 * @param {number}   opts.year         Año del reporte
 * @param {Array}    opts.monthlyData  Datos por mes (parsedos del controller)
 * @param {Object}   opts.prevData     { '01': { airbnbTotal, noches }, ... } del año anterior
 * @param {number}   opts.prevYear     Año anterior (year - 1)
 * @param {string[]} opts.mesesFaltantes Meses en formato '01'–'12' sin datos
 * @returns {Promise<Buffer>}
 */
async function generateAnnualReport({ year, monthlyData, prevData, prevYear, mesesFaltantes, analysisText }) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Airbnb Finance Assistant';
  wb.created  = new Date();
  wb.modified = new Date();

  buildSheet1(wb, year, monthlyData, prevData, prevYear, mesesFaltantes);
  buildSheet2(wb, year, monthlyData, prevData, prevYear);
  if (analysisText) buildAnalysisSheet(wb, analysisText);

  return wb.xlsx.writeBuffer();
}

// ── Hoja 1: Resumen Anual ─────────────────────────────────────

function buildSheet1(wb, year, monthlyData, prevData, prevYear, mesesFaltantes) {
  const ws  = wb.addWorksheet(`Resumen Anual ${year}`);
  const bdr = thinBorder();

  // Anchos de columna A–L
  [20, 9, 16, 16, 14, 14, 16, 16, 11, 16, 14, 12].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // ── Fila 1: título principal ─────────────────────────────────
  mergeCell(ws, 1, 1, 1, NUM_COLS,
    `REPORTE ANUAL DE INGRESOS ${year}`,
    {
      font:  mkFont(true, 14, C.FONT_WHITE),
      fill:  solidFill(C.DARK_BLUE),
      align: { horizontal: 'center', vertical: 'middle' },
    }
  );
  ws.getRow(1).height = 28;

  // ── Fila 2: mensaje de completitud ───────────────────────────
  const hasFalt    = mesesFaltantes.length > 0;
  const faltNames  = mesesFaltantes.map(m => MONTH_NAMES_ES[m]).join(', ');
  const statusMsg  = hasFalt
    ? `⚠ Reporte parcial — faltan ${mesesFaltantes.length} mes${mesesFaltantes.length !== 1 ? 'es' : ''}: ${faltNames}`
    : '✓ Reporte completo — 12 meses';

  mergeCell(ws, 2, 1, 2, NUM_COLS, statusMsg, {
    font:  mkFont(true, 10, hasFalt ? C.FONT_AMBER : C.FONT_GREEN),
    fill:  solidFill(hasFalt ? C.YELLOW : C.GREEN_BG),
    align: { horizontal: 'left', vertical: 'middle', indent: 1 },
  });
  ws.getRow(2).height = 20;

  // ── Fila 3: separador vacío ──────────────────────────────────
  ws.getRow(3).height = 6;

  // ── Fila 4: encabezados de columna ───────────────────────────
  const headers = [
    'Mes', 'Noches', 'Ingresos brutos', 'Comisión Airbnb',
    'IVA retenido (8%)', 'ISR retenido (4%)', 'Total deducciones',
    'Neto pagado', 'Match rate',
    `${prevYear}`, 'Variación $', 'Variación %',
  ];
  const fntHdr = mkFont(true, 10, C.FONT_WHITE);
  const fillHdr = solidFill(C.MID_BLUE);
  headers.forEach((h, i) => {
    sc(ws, 4, i + 1, h, {
      font:   fntHdr,
      fill:   fillHdr,
      border: bdr,
      align:  i === 0 ? aL : aC,
    });
  });
  ws.getRow(4).height = 20;

  // ── Construir mapa de datos por mes '01'–'12' ─────────────────
  const dataByMonth = {};
  monthlyData.forEach(d => {
    const mm = d.month.split('-')[1];
    dataByMonth[mm] = d;
  });

  // ── Filas 5–16: un mes calendario por fila ───────────────────
  const DATA_START = 5;
  const DATA_END   = 16;   // siempre 12 filas (todos los meses)
  const fntN   = mkFont(false, 10, C.FONT_DARK);
  const fntAmb = mkFont(false, 10, C.FONT_AMBER);

  ALL_MONTHS.forEach((mm, idx) => {
    const row      = DATA_START + idx;
    const isEven   = idx % 2 === 0;
    const altFill  = solidFill(isEven ? C.PALE_BLUE : C.WHITE);
    const d        = dataByMonth[mm];
    const isFalt   = mesesFaltantes.includes(mm);

    if (d) {
      // ── Fila con datos reales ────────────────────────────────
      const matchNum = parseRate(d.matchRate);
      const gross    = d.grossIncome || d.airbnbTotal || 0;

      sc(ws, row, 1,  d.label,                 { font: fntN, fill: altFill, border: bdr, align: aL });
      // Noches: mostrar '-' cuando el dato no estaba disponible al guardar el reporte
      if (d.noches != null) {
        sc(ws, row, 2, d.noches, { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: INT_FMT });
      } else {
        sc(ws, row, 2, '—', { font: mkFont(false, 10, C.FONT_MUTED), fill: altFill, border: bdr, align: aC });
      }
      sc(ws, row, 3,  gross,                   { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      const comision = d.comisionAirbnb || 0;
      const iva      = d.ivaRetenido    || 0;
      const isr      = d.isrRetenido    || 0;
      // Total deducciones pre-calculado para evitar celdas sin resultado cacheado ("None")
      const totalDed = Math.round((comision + iva + isr) * 100) / 100;

      sc(ws, row, 4, comision,  { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sc(ws, row, 5, iva,       { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sc(ws, row, 6, isr,       { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sc(ws, row, 7, totalDed,  { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sc(ws, row, 8,  d.airbnbTotal || 0,      { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });

      if (matchNum != null) {
        sc(ws, row, 9, matchNum, { font: fntN, fill: altFill, border: bdr, align: aC, numFmt: PCT_FMT });
      } else {
        sc(ws, row, 9, d.matchRate || '—',     { font: fntN, fill: altFill, border: bdr, align: aC });
      }

      const prevAmt = (prevData[mm] && prevData[mm].airbnbTotal) || 0;
      sc(ws, row, 10, prevAmt,                 { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sf(ws, row, 11, `H${row}-J${row}`,       { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: NUM_FMT });
      sf(ws, row, 12, `IF(J${row}<>0,(H${row}-J${row})/J${row},"-")`,
                                               { font: fntN, fill: altFill, border: bdr, align: aR, numFmt: PCT_FMT });

    } else if (isFalt) {
      // ── Fila de mes faltante (fondo amarillo) ─────────────────
      const missFill = solidFill(C.YELLOW);
      sc(ws, row, 1, `${MONTH_NAMES_ES[mm]} — Mes faltante`,
        { font: fntAmb, fill: missFill, border: bdr, align: aL });
      for (let c = 2; c <= NUM_COLS; c++) {
        sc(ws, row, c, '', { fill: missFill, border: bdr });
      }
    }

    ws.getRow(row).height = 18;
  });

  // ── Fila 17: TOTAL ───────────────────────────────────────────
  const TOTAL_ROW  = 17;
  const fillTotal  = solidFill(C.LIGHT_BLUE);
  const fntTotal   = mkFont(true, 10, C.FONT_DARK);

  const colLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const sumRange   = (col) => `${col}${DATA_START}:${col}${DATA_END}`;

  sc(ws, TOTAL_ROW, 1, 'TOTAL', { font: fntTotal, fill: fillTotal, border: bdr, align: aL });

  // B: suma noches
  sf(ws, TOTAL_ROW, 2, `SUM(${sumRange('B')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: INT_FMT });
  // C: suma ingresos brutos
  sf(ws, TOTAL_ROW, 3, `SUM(${sumRange('C')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // D: suma comisión
  sf(ws, TOTAL_ROW, 4, `SUM(${sumRange('D')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // E: suma IVA
  sf(ws, TOTAL_ROW, 5, `SUM(${sumRange('E')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // F: suma ISR
  sf(ws, TOTAL_ROW, 6, `SUM(${sumRange('F')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // G: suma deducciones (pre-calculada para evitar resultado cacheado vacío)
  const totalDeducciones = Math.round(
    monthlyData.reduce((s, d) => s + (d.comisionAirbnb || 0) + (d.ivaRetenido || 0) + (d.isrRetenido || 0), 0) * 100
  ) / 100;
  sc(ws, TOTAL_ROW, 7, totalDeducciones, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // H: suma neto pagado
  sf(ws, TOTAL_ROW, 8, `SUM(${sumRange('H')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });

  // I: tasa match global (promedio en JS, no fórmula)
  const validRates = monthlyData.map(d => parseRate(d.matchRate)).filter(r => r !== null);
  const avgRate    = validRates.length > 0
    ? validRates.reduce((a, b) => a + b, 0) / validRates.length : 0;
  sc(ws, TOTAL_ROW, 9, avgRate, { font: fntTotal, fill: fillTotal, border: bdr, align: aC, numFmt: PCT_FMT });

  // J: suma año anterior
  sf(ws, TOTAL_ROW, 10, `SUM(${sumRange('J')})`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // K: variación total
  sf(ws, TOTAL_ROW, 11, `H${TOTAL_ROW}-J${TOTAL_ROW}`, { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: NUM_FMT });
  // L: variación %
  sf(ws, TOTAL_ROW, 12, `IF(J${TOTAL_ROW}<>0,(H${TOTAL_ROW}-J${TOTAL_ROW})/J${TOTAL_ROW},"-")`,
    { font: fntTotal, fill: fillTotal, border: bdr, align: aR, numFmt: PCT_FMT });

  ws.getRow(TOTAL_ROW).height = 20;

  // ── Fila 18: nota al pie (IVA/ISR aproximados para reportes antiguos) ─
  const NOTE_ROW = 18;
  mergeCell(ws, NOTE_ROW, 1, NOTE_ROW, NUM_COLS,
    '* Para meses guardados antes de la actualización: IVA e ISR calculados como 8% y 4% del neto pagado; comisión Airbnb aproximada al 3.5%. Para datos exactos, vuelve a guardar esos reportes mensuales.',
    {
      font:  { name: 'Arial', size: 8, italic: true, color: { argb: 'FF6B7280' } },
      align: { horizontal: 'left', vertical: 'middle', indent: 1 },
    }
  );
  ws.getRow(NOTE_ROW).height = 24;

  // ── Fila 19: separador ───────────────────────────────────────
  ws.getRow(19).height = 8;

  // ── Fila 20: título de indicadores ──────────────────────────
  mergeCell(ws, 20, 1, 20, NUM_COLS, 'INDICADORES ANUALES', {
    font:  mkFont(true, 12, C.FONT_WHITE),
    fill:  solidFill(C.DARK_BLUE),
    align: { horizontal: 'center', vertical: 'middle' },
  });
  ws.getRow(20).height = 22;

  // ── Calcular valores para indicadores ────────────────────────
  const dataMonths  = monthlyData.filter(d => d.airbnbTotal > 0);
  const count       = dataMonths.length;
  const totalNeto   = dataMonths.reduce((s, d) => s + d.airbnbTotal, 0);
  // Para noches: usar 0 cuando el dato es null (meses sin excelData)
  const totalNoches = dataMonths.reduce((s, d) => s + (d.noches != null ? d.noches : 0), 0);
  const nochesCount = dataMonths.filter(d => d.noches != null).length; // meses con noches reales
  const totalIva    = dataMonths.reduce((s, d) => s + (d.ivaRetenido || 0), 0);
  const isLeap      = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const diasAnio    = isLeap ? 366 : 365;

  const maxMonth = count > 0
    ? dataMonths.reduce((a, b) => b.airbnbTotal > a.airbnbTotal ? b : a)
    : null;
  const minMonth = count > 0
    ? dataMonths.reduce((a, b) => b.airbnbTotal < a.airbnbTotal ? b : a)
    : null;

  const avgMatchRateAll = validRates.length > 0
    ? validRates.reduce((a, b) => a + b, 0) / validRates.length : 0;

  // Tabla indicadores: 4 filas x 2 indicadores (columnas fusionadas)
  // Estructura: [label_izq, valor_izq, label_der, valor_der, numFmt_izq, numFmt_der]
  const nochesPromedio = nochesCount > 0 ? totalNoches / nochesCount : '—';
  const ocupProm       = nochesCount > 0 ? totalNoches / diasAnio : '—';
  const indRows = [
    ['Mes mayor ingreso',   maxMonth?.label  || '—',   'Mes menor ingreso',   minMonth?.label || '—',  null,    null],
    ['Promedio mensual',    count > 0 ? totalNeto / count : 0,
                                                        'Noches promedio',     nochesPromedio,          NUM_FMT, typeof nochesPromedio === 'number' ? '#,##0.0' : null],
    ['Ocupación promedio',  ocupProm,                   'Meses completos',     `${12 - mesesFaltantes.length} / 12`,
                                                                                                         typeof ocupProm === 'number' ? PCT_FMT : null, null],
    ['Tasa match global',   avgMatchRateAll,             'IVA total retenido',  totalIva,                PCT_FMT, NUM_FMT],
  ];

  indRows.forEach(([lLabel, lVal, rLabel, rVal, lFmt, rFmt], idx) => {
    const r       = 21 + idx;
    const altFill = solidFill(idx % 2 === 0 ? C.PALE_BLUE : C.WHITE);
    const fntLbl  = mkFont(true,  10, C.FONT_DARK);
    const fntVal  = mkFont(false, 10, C.FONT_DARK);

    // Indicador izquierdo: label fusionado A–E, valor en F
    mergeCell(ws, r, 1, r, 5, lLabel, { font: fntLbl, fill: altFill, align: aL, border: bdr });
    sc(ws, r, 6, lVal, { font: fntVal, fill: altFill, border: bdr, align: aR, numFmt: lFmt });

    // Indicador derecho: label fusionado G–K, valor en L
    mergeCell(ws, r, 7, r, 11, rLabel, { font: fntLbl, fill: altFill, align: aL, border: bdr });
    sc(ws, r, 12, rVal, { font: fntVal, fill: altFill, border: bdr, align: aR, numFmt: rFmt });

    ws.getRow(r).height = 18;
  });

  // Congelar encabezados en fila 5
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4, topLeftCell: 'A5' }];
}

// ── Hoja 3: Análisis IA ────────────────────────────────────────

/**
 * buildAnalysisSheet — Escribe el análisis de IA en una nueva hoja
 * @param {ExcelJS.Workbook} wb
 * @param {string} analysisText  Texto en Markdown con cabeceras ## para secciones
 */
function buildAnalysisSheet(wb, analysisText) {
  const ws = wb.addWorksheet('Análisis IA');

  // Columna ancha para que el texto envuelto quepa bien
  ws.getColumn(1).width = 110;

  // Fila 1: título
  mergeCell(ws, 1, 1, 1, 1, 'ANÁLISIS INTELIGENTE — REPORTE ANUAL', {
    font:  mkFont(true, 13, C.FONT_WHITE),
    fill:  solidFill(C.DARK_BLUE),
    align: { horizontal: 'center', vertical: 'middle' },
  });
  ws.getRow(1).height = 28;

  // Parsear líneas y escribir sección por sección
  const lines = analysisText.split('\n');
  let row = 2;
  lines.forEach(line => {
    const cell = ws.getCell(row, 1);
    if (line.startsWith('## ')) {
      cell.value     = line.replace(/^## /, '').toUpperCase();
      cell.font      = mkFont(true, 11, C.FONT_WHITE);
      cell.fill      = solidFill(C.MID_BLUE);
      cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
      ws.getRow(row).height = 20;
    } else if (line.trim() === '') {
      ws.getRow(row).height = 6;
    } else {
      cell.value     = line;
      cell.font      = mkFont(false, 10, C.FONT_DARK);
      cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
      ws.getRow(row).height = 36;
    }
    row++;
  });
}

// ── Hoja 2: Gráfica Ingresos ──────────────────────────────────

function buildSheet2(wb, year, monthlyData, prevData, prevYear) {
  const ws  = wb.addWorksheet('Gráfica Ingresos');
  const bdr = thinBorder();

  // Anchos A–D
  [20, 16, 16, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Fila 1: título
  ws.mergeCells(1, 1, 1, 4);
  const titleCell     = ws.getCell(1, 1);
  titleCell.value     = `DATOS PARA GRÁFICA — Ingresos mensuales ${year} vs ${prevYear}`;
  titleCell.font      = mkFont(true, 12, C.FONT_WHITE);
  titleCell.fill      = solidFill(C.DARK_BLUE);
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  // Fila 2: encabezados
  const hFnt  = mkFont(true, 10, C.FONT_WHITE);
  const hFill = solidFill(C.MID_BLUE);
  ['Mes', `${year}`, `${prevYear}`, 'Variación %'].forEach((h, i) => {
    const cell       = ws.getCell(2, i + 1);
    cell.value       = h;
    cell.font        = hFnt;
    cell.fill        = hFill;
    cell.border      = bdr;
    cell.alignment   = i === 0 ? aL : aR;
  });
  ws.getRow(2).height = 18;

  // Filas de datos — solo meses con ingresos reales
  let dataRow    = 3;
  const dataMonths = monthlyData.filter(d => d.airbnbTotal > 0);

  dataMonths.forEach((d, idx) => {
    const mm      = d.month.split('-')[1];
    const prevAmt = (prevData[mm] && prevData[mm].airbnbTotal) || 0;
    const varPct  = prevAmt > 0 ? (d.airbnbTotal - prevAmt) / prevAmt : null;
    const altFill = solidFill(idx % 2 === 0 ? C.PALE_BLUE : C.WHITE);
    const varColor = varPct != null ? (varPct >= 0 ? C.FONT_GREEN : C.FONT_RED) : C.FONT_DARK;

    const c1 = ws.getCell(dataRow, 1);
    c1.value = d.label; c1.font = mkFont(false, 10); c1.fill = altFill;
    c1.border = bdr; c1.alignment = aL;

    const c2 = ws.getCell(dataRow, 2);
    c2.value = d.airbnbTotal; c2.font = mkFont(false, 10); c2.fill = altFill;
    c2.border = bdr; c2.numFmt = NUM_FMT; c2.alignment = aR;

    const c3 = ws.getCell(dataRow, 3);
    c3.value = prevAmt; c3.font = mkFont(false, 10); c3.fill = altFill;
    c3.border = bdr; c3.numFmt = NUM_FMT; c3.alignment = aR;

    const c4 = ws.getCell(dataRow, 4);
    c4.value = varPct; c4.font = mkFont(false, 10, varColor); c4.fill = altFill;
    c4.border = bdr; c4.numFmt = varPct != null ? PCT_FMT : '@'; c4.alignment = aR;

    ws.getRow(dataRow).height = 18;
    dataRow++;
  });

  // Fila de nota (después de una fila vacía)
  const noteRow   = dataRow + 1;
  ws.mergeCells(noteRow, 1, noteRow, 4);
  const noteCell   = ws.getCell(noteRow, 1);
  noteCell.value   = 'Para insertar gráfica: selecciona esta tabla → Insertar → Gráfico de líneas o columnas';
  noteCell.font    = { name: 'Arial', size: 9, italic: true, color: { argb: C.FONT_MUTED } };
  noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(noteRow).height = 16;
}

module.exports = { generateAnnualReport };
