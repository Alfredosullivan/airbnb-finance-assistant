// report.controller.js — Controlador del reporte comparativo
// Orquesta el parseo de los archivos, la comparación y el formateo del resultado final.
// Toda la data temporal se lee de la sesión del usuario (SessionStore), no de un singleton global.

'use strict';

const logger = require('../config/logger');
const SessionStore = require('../store/SessionStore');
const { parseAirbnbPDF, parseBankPDF } = require('../services/pdfParser');
const { parseAirbnbCSV } = require('../services/csvParser');
const { compareTransactions } = require('../services/comparator');
const { formatReport } = require('../utils/formatter');
const { generateMonthlyReport } = require('../services/excelGenerator');
const { generateMonthlyAnalysis } = require('../services/analysisGenerator');
const ReportRepo = require('../repositories/ReportRepository');
const queue = require('../queue/MemoryQueue');
const { calcularComisionDesdeReservaciones } = require('../utils/airbnbMetrics');

// ── Helper privado ─────────────────────────────────────────────

/**
 * getSessionId — Lee el sessionId desde header (fetch) o query param (window.open).
 * El query param existe para soportar la descarga de Excel vía window.open,
 * que no puede enviar headers personalizados.
 */
function getSessionId(req) {
  return req.headers['x-session-id'] || req.query.sessionId || null;
}

/**
 * buildAnalysisData — Construye el objeto de datos que espera generateMonthlyAnalysis.
 * Extrae noches, comisión y totales de la sesión y los normaliza en una estructura uniforme.
 * Usado por getMonthlyAnalysis y getMonthlyAnalysisPDF para evitar duplicación.
 *
 * @param {Object} compareResult - Resultado del comparator (session.compareResult)
 * @param {Object} airbnbData    - Datos parseados de Airbnb (session.airbnbData)
 * @returns {Object} Payload listo para generateMonthlyAnalysis
 */
function buildAnalysisData(compareResult, airbnbData) {
  const payouts = airbnbData.payouts || [];
  const { noches, comisionAirbnb: comision } = calcularComisionDesdeReservaciones(payouts);
  const airbnbTotal = parseFloat(
    compareResult?.totals?.totalAirbnbPayouts ||
      compareResult?.summary?.totalAirbnbPayouts ||
      compareResult?.summary?.airbnbTotal ||
      0
  );

  return {
    reportLabel: compareResult.reportLabel || airbnbData.reportLabel || 'Este mes',
    summary: {
      airbnbTotal,
      bankTotal:
        compareResult?.totals?.totalBankDeposits || compareResult?.summary?.totalBankDeposits || 0,
      matchRate: compareResult?.totals?.matchRate || compareResult?.summary?.matchRate || '0%',
      netDifference:
        compareResult?.totals?.netDifference || compareResult?.summary?.netDifference || 0,
    },
    tables: {
      matched: compareResult.matched || compareResult.tables?.matched || [],
      onlyInAirbnb: compareResult.onlyInAirbnb || compareResult.tables?.onlyInAirbnb || [],
      onlyInBank: compareResult.onlyInBank || compareResult.tables?.onlyInBank || [],
    },
    excelData: {
      noches,
      comisionAirbnb: parseFloat(comision.toFixed(2)),
      ivaRetenido: parseFloat((airbnbTotal * 0.08).toFixed(2)),
      isrRetenido: parseFloat((airbnbTotal * 0.04).toFixed(2)),
    },
  };
}

/**
 * getReport — Genera el reporte comparativo entre Airbnb y el banco.
 * Flujo: leer sesión → parsear archivos → comparar → formatear → guardar en sesión → responder.
 * GET /api/report  (requiere auth + X-Session-Id)
 */
async function getReport(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = getSessionId(req);
    const session = SessionStore.get(userId, sessionId);

    if (!session) {
      return res.status(400).json({
        error: 'Sesión no encontrada o expirada. Vuelve a subir los archivos.',
      });
    }

    if (!session.airbnbPath) {
      return res.status(400).json({
        error: 'Debes subir el reporte de Airbnb (CSV o PDF) antes de generar el reporte',
      });
    }
    if (!session.bankPaths || session.bankPaths.length === 0) {
      return res
        .status(400)
        .json({ error: 'Debes subir al menos un PDF bancario antes de generar el reporte' });
    }

    // 1. Parsear el archivo de Airbnb según su tipo detectado al subir
    let airbnbData;
    if (session.airbnbFileType === 'csv') {
      airbnbData = await parseAirbnbCSV(session.airbnbPath);
    } else {
      airbnbData = await parseAirbnbPDF(session.airbnbPath);
    }

    if (airbnbData.error) {
      return res.status(422).json({ error: `Error al parsear Airbnb: ${airbnbData.message}` });
    }

    // 2. Parsear cada PDF bancario por separado
    const bankParsedResults = await Promise.all(
      session.bankPaths.map((filePath) => parseBankPDF(filePath))
    );

    for (const result of bankParsedResults) {
      if (result.error) {
        return res.status(422).json({ error: `Error al parsear banco: ${result.message}` });
      }
    }

    const bankData = {
      bankPdf1: bankParsedResults[0] || { airbnbDeposits: [], allDeposits: [] },
      bankPdf2: bankParsedResults[1] || null,
    };

    // 3. Cruzar transacciones y calcular diferencias
    const compareResult = compareTransactions(airbnbData, bankData, airbnbData.reportMonth || null);

    // 4. Dar formato final al JSON de respuesta
    const report = formatReport(compareResult);

    // Guardar en la sesión del usuario (aislado por userId:sessionId)
    session.reportData = report;
    session.airbnbData = airbnbData;
    session.compareResult = compareResult;

    return res.json(report);
  } catch (err) {
    return res.status(500).json({ error: `Error al generar el reporte: ${err.message}` });
  }
}

/**
 * generateExcel — Genera y descarga el reporte mensual en formato .xlsx.
 * Acepta sessionId por header O por query param (para soportar window.open desde el browser).
 * GET /api/report/excel  (requiere auth)
 */
async function generateExcel(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = getSessionId(req);
    const session = SessionStore.get(userId, sessionId);

    if (!session || !session.airbnbData || !session.compareResult) {
      return res
        .status(400)
        .json({ error: 'Genera primero la comparativa antes de descargar el Excel' });
    }

    const { airbnbData, compareResult } = session;

    // Buscar reporte del año anterior si hay sesión activa
    let previousYearReport = null;
    const reportMonth = compareResult.reportMonth || airbnbData.reportMonth || null;
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    if (reportMonth && /^\d{4}-\d{2}$/.test(reportMonth)) {
      const [year, month] = reportMonth.split('-');
      const prevMonth = `${parseInt(year, 10) - 1}-${month}`;

      const prevRow = propertyId
        ? await ReportRepo.findSummaryByMonth(userId, propertyId, prevMonth)
        : await ReportRepo.findSummaryByMonthAny(userId, prevMonth);

      if (prevRow) {
        try {
          previousYearReport = JSON.parse(prevRow.summary);
        } catch (_) {}
      }

      if (!previousYearReport) {
        const currRow = propertyId
          ? await ReportRepo.findSummaryByMonth(userId, propertyId, reportMonth)
          : await ReportRepo.findSummaryByMonthAny(userId, reportMonth);

        if (currRow) {
          let currReport = null;
          try {
            currReport = JSON.parse(currRow.summary);
          } catch (_) {}
          const pvd = currReport?.summary?.prevYearData;
          if (pvd) {
            previousYearReport = {
              summary: {
                totalAirbnbPayouts: pvd.totalAirbnbPayouts || 0,
                totalBankDeposits: pvd.totalBankDeposits || 0,
                matchRate: pvd.matchRate || '0%',
                payoutsCount: pvd.payoutsCount || 0,
                matchedCount: pvd.matchedCount || 0,
                onlyAirbnbCount: pvd.onlyAirbnbCount || 0,
                onlyBankCount: pvd.onlyBankCount || 0,
              },
              excelData: { noches: pvd.noches || 0 },
            };
            logger.info('[excel] previousYearReport construido desde prevYearData inyectado');
          }
        }
      }
    }

    // Intentar generar análisis IA para Hoja 4 (falla silenciosamente si no hay API key)
    let analysisText = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const data = buildAnalysisData(compareResult, airbnbData);
        analysisText = await generateMonthlyAnalysis(data);
        logger.info('[excel] Análisis IA generado para Hoja 4');
      } catch (analysisErr) {
        logger.warn('[excel] Análisis IA no disponible:', analysisErr.message);
      }
    }

    const buffer = await generateMonthlyReport(
      airbnbData,
      compareResult,
      previousYearReport,
      analysisText
    );

    const filename = `Reporte_${reportMonth || 'reporte'}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    logger.error('[excel] Error al generar Excel:', err.message);
    return res.status(500).json({ error: `Error al generar el Excel: ${err.message}` });
  }
}

/**
 * getMonthlyAnalysis — Genera el análisis IA del reporte en sesión.
 * POST /api/analysis/monthly  (requiere auth)
 */
async function getMonthlyAnalysis(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = getSessionId(req);
    const session = SessionStore.get(userId, sessionId);

    if (!session || !session.compareResult || !session.airbnbData) {
      return res
        .status(400)
        .json({ error: 'Genera primero la comparativa antes de solicitar el análisis' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error:
          'ANTHROPIC_API_KEY no está configurada en el servidor. Agrega la variable en el archivo .env',
      });
    }

    const { compareResult, airbnbData } = session;
    const data = buildAnalysisData(compareResult, airbnbData);
    const analysis = await generateMonthlyAnalysis(data);
    return res.json({ success: true, analysis });
  } catch (err) {
    logger.error('[analysis] Error en getMonthlyAnalysis:', err.message);
    return res.status(500).json({ error: `Error al generar el análisis: ${err.message}` });
  }
}

/**
 * getMonthlyAnalysisPDF — Descarga el análisis mensual como PDF.
 * POST /api/analysis/monthly/pdf  (requiere auth)
 */
async function getMonthlyAnalysisPDF(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = getSessionId(req);
    const session = SessionStore.get(userId, sessionId);

    if (!session || !session.compareResult || !session.airbnbData) {
      return res.status(400).json({ error: 'Genera primero la comparativa' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY no está configurada' });
    }

    const { compareResult, airbnbData } = session;
    const data = buildAnalysisData(compareResult, airbnbData);
    const analysisText = await generateMonthlyAnalysis(data);

    const PDFDocument = require('pdfkit');
    const label = compareResult.reportLabel || airbnbData.reportLabel || 'Reporte';
    const safeLabel = label
      .replace(/[^a-zA-Z0-9À-ÿ ]/g, '')
      .trim()
      .replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Analisis_${safeLabel}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text(`Análisis Financiero — ${label}`, { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`Generado el ${new Date().toLocaleDateString('es-MX')} con IA (Claude)`, {
        align: 'center',
      });
    doc.moveDown(2);

    const lines = analysisText.split('\n');
    lines.forEach((line) => {
      if (line.startsWith('## ')) {
        doc.moveDown(0.5);
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#1F4E79').text(line.replace('## ', ''));
        doc.moveDown(0.3);
        doc.fillColor('#000000');
      } else if (line.startsWith('- ')) {
        doc.fontSize(10).font('Helvetica').text(line, { indent: 15 });
      } else if (line.trim()) {
        doc.fontSize(10).font('Helvetica').text(line);
      } else {
        doc.moveDown(0.3);
      }
    });

    doc.end();
  } catch (err) {
    logger.error('[analysis] Error en getMonthlyAnalysisPDF:', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: `Error al generar el PDF: ${err.message}` });
    }
  }
}

/**
 * queueExcelGeneration — Encola la generación del Excel en background.
 * POST /api/excel/queue  (requiere auth)
 *
 * Captura un snapshot de airbnbData y compareResult de la sesión en el momento del encolado.
 * El worker es autosuficiente: no depende del SessionStore después del encolado.
 */
async function queueExcelGeneration(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = getSessionId(req);
    const session = SessionStore.get(userId, sessionId);

    if (!session || !session.airbnbData || !session.compareResult) {
      return res.status(400).json({
        error: 'Genera primero la comparativa (GET /api/report) antes de encolar el Excel',
      });
    }

    const { airbnbData, compareResult } = session;
    const propertyId = req.body.propertyId || null;
    const month = req.body.month || compareResult.reportMonth || airbnbData.reportMonth || null;
    const label = req.body.label || compareResult.reportLabel || airbnbData.reportLabel || month;

    if (!month) {
      return res.status(400).json({
        error:
          'El campo month es requerido (formato YYYY-MM) o asegúrate de haber generado el reporte primero',
      });
    }

    // Snapshot en el payload del job para que el worker sea autosuficiente
    const job = queue.addJob('excel_generation', {
      userId,
      propertyId,
      month,
      label,
      airbnbData,
      compareResult,
    });

    return res.status(202).json({
      jobId: job.id,
      status: job.status,
      message: `Excel encolado para ${label}. Consulta el estado en GET /api/jobs/${job.id}`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getReport,
  generateExcel,
  getMonthlyAnalysis,
  getMonthlyAnalysisPDF,
  queueExcelGeneration,
};
