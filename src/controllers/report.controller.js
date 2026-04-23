// report.controller.js — Controlador del reporte comparativo
// Orquesta el parseo de los archivos, la comparación y el formateo del resultado final

const { store }                                = require('./upload.controller');
const { parseAirbnbPDF, parseBankPDF }         = require('../services/pdfParser');
const { parseAirbnbCSV }                       = require('../services/csvParser');
const { compareTransactions }                  = require('../services/comparator');
const { formatReport }                         = require('../utils/formatter');
const { generateMonthlyReport }                = require('../services/excelGenerator');
const { generateMonthlyAnalysis }              = require('../services/analysisGenerator');
const ReportRepo                               = require('../repositories/ReportRepository');
const queue                                    = require('../queue/MemoryQueue');

// ── Helper privado ─────────────────────────────────────────────

/**
 * buildAnalysisData — Construye el objeto de datos que espera generateMonthlyAnalysis.
 * Extrae noches, comisión y totales del store y los normaliza en una estructura uniforme.
 * Usado por getMonthlyAnalysis y getMonthlyAnalysisPDF para evitar duplicación.
 *
 * @param {Object} compareResult - Resultado del comparator (store.compareResult)
 * @param {Object} airbnbData    - Datos parseados de Airbnb (store.airbnbData)
 * @returns {Object} Payload listo para generateMonthlyAnalysis
 */
function buildAnalysisData(compareResult, airbnbData) {
  const payouts    = airbnbData.payouts || [];
  const noches     = payouts.reduce((s, p) =>
    s + (p.reservations || []).reduce((ss, r) => ss + (parseInt(r.nights, 10) || 0), 0), 0);
  const comision   = payouts.reduce((s, p) =>
    s + (p.reservations || []).reduce((ss, r) => ss + (parseFloat(r.serviceFee) || 0), 0), 0);
  const airbnbTotal = parseFloat(
    compareResult?.totals?.totalAirbnbPayouts ||
    compareResult?.summary?.totalAirbnbPayouts ||
    compareResult?.summary?.airbnbTotal || 0
  );

  return {
    reportLabel: compareResult.reportLabel || airbnbData.reportLabel || 'Este mes',
    summary: {
      airbnbTotal,
      bankTotal:     compareResult?.totals?.totalBankDeposits  || compareResult?.summary?.totalBankDeposits || 0,
      matchRate:     compareResult?.totals?.matchRate          || compareResult?.summary?.matchRate         || '0%',
      netDifference: compareResult?.totals?.netDifference      || compareResult?.summary?.netDifference     || 0,
    },
    tables: {
      matched:      compareResult.matched      || compareResult.tables?.matched      || [],
      onlyInAirbnb: compareResult.onlyInAirbnb || compareResult.tables?.onlyInAirbnb || [],
      onlyInBank:   compareResult.onlyInBank   || compareResult.tables?.onlyInBank   || [],
    },
    excelData: {
      noches,
      comisionAirbnb: parseFloat(comision.toFixed(2)),
      ivaRetenido:    parseFloat((airbnbTotal * 0.08).toFixed(2)),
      isrRetenido:    parseFloat((airbnbTotal * 0.04).toFixed(2)),
    },
  };
}

/**
 * getReport — Genera el reporte comparativo entre Airbnb y el banco
 * Flujo: leer rutas guardadas → parsear archivos → comparar → formatear → responder
 * Soporta Airbnb en CSV o PDF, y 1 o 2 PDFs bancarios
 */
async function getReport(req, res) {
  try {
    // Verificar que ambos archivos hayan sido subidos previamente
    if (!store.airbnbPath) {
      return res.status(400).json({ error: 'Debes subir el reporte de Airbnb (CSV o PDF) antes de generar el reporte' });
    }
    if (!store.bankPaths || store.bankPaths.length === 0) {
      return res.status(400).json({ error: 'Debes subir al menos un PDF bancario antes de generar el reporte' });
    }

    // 1. Parsear el archivo de Airbnb según su tipo detectado al subir
    let airbnbData;
    if (store.airbnbFileType === 'csv') {
      airbnbData = await parseAirbnbCSV(store.airbnbPath);
    } else {
      airbnbData = await parseAirbnbPDF(store.airbnbPath);
    }

    // Si el parser devolvió un error, propagarlo
    if (airbnbData.error) {
      return res.status(422).json({ error: `Error al parsear Airbnb: ${airbnbData.message}` });
    }

    // 2. Parsear cada PDF bancario por separado (parseBankPDF puede llamarse N veces)
    const bankParsedResults = await Promise.all(
      store.bankPaths.map(filePath => parseBankPDF(filePath))
    );

    // Verificar errores de parseo bancario
    for (const result of bankParsedResults) {
      if (result.error) {
        return res.status(422).json({ error: `Error al parsear banco: ${result.message}` });
      }
    }

    // Construir objeto estructurado para el comparator
    const bankData = {
      bankPdf1: bankParsedResults[0] || { airbnbDeposits: [], allDeposits: [] },
      bankPdf2: bankParsedResults[1] || null,
    };

    // 3. Cruzar las transacciones y calcular diferencias
    // Pasar el mes del reporte de Airbnb para filtrar depósitos bancarios al período correcto
    const compareResult = compareTransactions(airbnbData, bankData, airbnbData.reportMonth || null);

    // 4. Dar formato final al JSON de respuesta
    const report = formatReport(compareResult);

    // Guardar en el store para /api/reset y para el generador de Excel
    store.reportData    = report;
    store.airbnbData    = airbnbData;
    store.compareResult = compareResult;

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: `Error al generar el reporte: ${err.message}` });
  }
}

/**
 * generateExcel — Genera y descarga el reporte mensual en formato .xlsx
 * Requiere que getReport haya sido llamado previamente (usa store.airbnbData y store.compareResult).
 * Si el usuario está autenticado, busca el reporte del mismo mes del año anterior en la DB.
 */
async function generateExcel(req, res) {
  try {
    const { airbnbData, compareResult } = store;

    if (!airbnbData || !compareResult) {
      return res.status(400).json({ error: 'Genera primero la comparativa antes de descargar el Excel' });
    }

    // Buscar reporte del año anterior si hay sesión activa
    let previousYearReport = null;
    if (req.user) {
      const reportMonth = compareResult.reportMonth || airbnbData.reportMonth || null;
      const propertyId  = parseInt(req.query.propertyId, 10) || null;

      if (reportMonth && /^\d{4}-\d{2}$/.test(reportMonth)) {
        const [year, month] = reportMonth.split('-');
        const prevMonth     = `${parseInt(year, 10) - 1}-${month}`;

        // ── Buscar reporte del año anterior (con filtro de propiedad si se indica) ─
        const prevRow = propertyId
          ? await ReportRepo.findSummaryByMonth(req.user.userId, propertyId, prevMonth)
          : await ReportRepo.findSummaryByMonthAny(req.user.userId, prevMonth);

        if (prevRow) {
          try { previousYearReport = JSON.parse(prevRow.summary); } catch (_) {}
        }

        // ── Fallback: leer prevYearData inyectado en el reporte guardado actual ─
        // Ocurre cuando el usuario ya actualizó el reporte del año siguiente con
        // updatePrevYearRef pero todavía no tiene el reporte del año anterior en la DB.
        if (!previousYearReport) {
          const currRow = propertyId
            ? await ReportRepo.findSummaryByMonth(req.user.userId, propertyId, reportMonth)
            : await ReportRepo.findSummaryByMonthAny(req.user.userId, reportMonth);

          if (currRow) {
            let currReport = null;
            try { currReport = JSON.parse(currRow.summary); } catch (_) {}
            const pvd = currReport?.summary?.prevYearData;
            if (pvd) {
              // Construir previousYearReport sintético con la estructura que espera buildSheet3
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
              console.log('[excel] previousYearReport construido desde prevYearData inyectado');
            }
          }
        }
      }
    }

    // ── Intentar generar análisis IA para Hoja 4 ─────────────────
    // Falla silenciosamente: el Excel se genera igual sin análisis si la API key
    // no está configurada o si hay un error de red.
    let analysisText = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const data = buildAnalysisData(compareResult, airbnbData);
        analysisText = await generateMonthlyAnalysis(data);
        console.log('[excel] Análisis IA generado para Hoja 4');
      } catch (analysisErr) {
        console.warn('[excel] Análisis IA no disponible:', analysisErr.message);
      }
    }

    const buffer = await generateMonthlyReport(airbnbData, compareResult, previousYearReport, analysisText);

    const reportMonth = compareResult.reportMonth || airbnbData.reportMonth || 'reporte';
    const filename    = `Reporte_${reportMonth}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('[excel] Error al generar Excel:', err.message);
    res.status(500).json({ error: `Error al generar el Excel: ${err.message}` });
  }
}

/**
 * getMonthlyAnalysis — Genera el análisis IA del reporte en memoria
 * POST /api/analysis/monthly
 * Requiere que getReport haya sido llamado antes (usa store.compareResult y store.airbnbData).
 */
async function getMonthlyAnalysis(req, res) {
  try {
    if (!store.compareResult || !store.airbnbData) {
      return res.status(400).json({ error: 'Genera primero la comparativa antes de solicitar el análisis' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY no está configurada en el servidor. Agrega la variable en el archivo .env' });
    }

    const { compareResult, airbnbData } = store;
    const data     = buildAnalysisData(compareResult, airbnbData);
    const analysis = await generateMonthlyAnalysis(data);
    return res.json({ success: true, analysis });

  } catch (err) {
    console.error('[analysis] Error en getMonthlyAnalysis:', err.message);
    return res.status(500).json({ error: `Error al generar el análisis: ${err.message}` });
  }
}

/**
 * getMonthlyAnalysisPDF — Descarga el análisis mensual como PDF
 * POST /api/analysis/monthly/pdf
 */
async function getMonthlyAnalysisPDF(req, res) {
  try {
    if (!store.compareResult || !store.airbnbData) {
      return res.status(400).json({ error: 'Genera primero la comparativa' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY no está configurada' });
    }

    const { compareResult, airbnbData } = store;
    const data         = buildAnalysisData(compareResult, airbnbData);
    const analysisText = await generateMonthlyAnalysis(data);

    // Generar PDF con pdfkit
    const PDFDocument = require('pdfkit');
    const label       = compareResult.reportLabel || airbnbData.reportLabel || 'Reporte';
    const safeLabel   = label.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Analisis_${safeLabel}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // Título
    doc.fontSize(20).font('Helvetica-Bold')
       .text(`Análisis Financiero — ${label}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica')
       .text(`Generado el ${new Date().toLocaleDateString('es-MX')} con IA (Claude)`, { align: 'center' });
    doc.moveDown(2);

    // Parsear secciones del análisis y escribirlas con formato
    const lines = analysisText.split('\n');
    lines.forEach(line => {
      if (line.startsWith('## ')) {
        doc.moveDown(0.5);
        doc.fontSize(13).font('Helvetica-Bold')
           .fillColor('#1F4E79')
           .text(line.replace('## ', ''));
        doc.moveDown(0.3);
        doc.fillColor('#000000');
      } else if (line.startsWith('- ')) {
        doc.fontSize(10).font('Helvetica')
           .text(line, { indent: 15 });
      } else if (line.trim()) {
        doc.fontSize(10).font('Helvetica')
           .text(line);
      } else {
        doc.moveDown(0.3);
      }
    });

    doc.end();

  } catch (err) {
    console.error('[analysis] Error en getMonthlyAnalysisPDF:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Error al generar el PDF: ${err.message}` });
    }
  }
}

/**
 * queueExcelGeneration — Encola la generación del Excel en background.
 * POST /api/excel/queue
 *
 * ¿Por qué capturamos airbnbData y compareResult del store aquí?
 * El worker necesita estos objetos para llamar a generateMonthlyReport()
 * con la firma correcta: (airbnbData, compareResult, previousYearReport, analysisText).
 * Estos datos solo existen en memoria durante la sesión del usuario — no se
 * persisten completos en la DB. Al incluirlos en el payload del job en el momento
 * del encolado, el worker los tiene disponibles sin depender del store
 * (que podría cambiar si el usuario sube otros archivos antes de que el worker termine).
 *
 * Responde con 202 Accepted inmediatamente — sin esperar a Claude ni a ExcelJS.
 */
async function queueExcelGeneration(req, res) {
  try {
    const { airbnbData, compareResult } = store;

    // Verificar que el usuario ya generó la comparativa
    if (!airbnbData || !compareResult) {
      return res.status(400).json({
        error: 'Genera primero la comparativa (GET /api/report) antes de encolar el Excel',
      });
    }

    const userId     = req.user.userId;
    const propertyId = req.body.propertyId || null;

    // month y label pueden venir del body o inferirse del store
    const month = req.body.month || compareResult.reportMonth || airbnbData.reportMonth || null;
    const label = req.body.label || compareResult.reportLabel || airbnbData.reportLabel || month;

    if (!month) {
      return res.status(400).json({
        error: 'El campo month es requerido (formato YYYY-MM) o asegúrate de haber generado el reporte primero',
      });
    }

    // Encolar el job — incluye snapshot de los datos del store para que el
    // worker sea autosuficiente incluso si el store cambia después
    const job = queue.addJob('excel_generation', {
      userId,
      propertyId,
      month,
      label,
      // Snapshot de los datos necesarios para generateMonthlyReport
      airbnbData:    airbnbData,
      compareResult: compareResult,
    });

    // 202 Accepted: la request fue aceptada pero el procesamiento no terminó aún.
    // Es el status HTTP correcto para operaciones asíncronas en background.
    res.status(202).json({
      jobId:   job.id,
      status:  job.status,
      message: `Excel encolado para ${label}. Consulta el estado en GET /api/jobs/${job.id}`,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getReport, generateExcel, getMonthlyAnalysis, getMonthlyAnalysisPDF, queueExcelGeneration };
