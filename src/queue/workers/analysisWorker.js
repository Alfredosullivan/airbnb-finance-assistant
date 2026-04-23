'use strict';

// analysisWorker.js — Worker que procesa jobs de tipo 'excel_generation'.
//
// Flujo por job:
//   1. Buscar reporte del año anterior en DB (para la hoja comparativa)
//   2. Construir el payload de análisis (misma lógica que buildAnalysisData en report.controller)
//   3. Llamar a Claude API — la parte lenta (5–25 s)
//   4. Intentar cachear el análisis en DB para no repetirlo en el futuro
//   5. Generar el buffer Excel con el análisis incluido como Hoja 4
//   6. Guardar el buffer como base64 en job.result
//
// ¿Por qué el payload incluye airbnbData y compareResult?
// generateMonthlyReport() necesita los datos crudos de transacciones (payouts,
// matched, onlyInAirbnb) para construir las hojas del Excel. Estos datos solo
// existen en el store en memoria y no se persisten completos en la DB.
// queueExcelGeneration los captura del store al momento de encolar y los
// incluye en job.data — así el worker es autosuficiente.

const queue          = require('../MemoryQueue');
const { generateMonthlyAnalysis } = require('../../services/analysisGenerator');
const { generateMonthlyReport }   = require('../../services/excelGenerator');
const ReportRepository            = require('../../repositories/ReportRepository');

// Tiempo entre ciclos del worker cuando no hay jobs pendientes
const POLL_INTERVAL = 2000;

// ── Lógica de construcción del payload de análisis ────────────────────────
//
// Duplicamos aquí la lógica de buildAnalysisData (report.controller.js) porque
// esa función es privada y no está exportada. Extraerla a un utils compartido
// sería el refactor correcto — por ahora la mantenemos cerca del worker
// para no modificar el controller en esta iteración.
// TODO: mover buildAnalysisData a src/utils/analysisDataBuilder.js

function buildAnalysisPayload(airbnbData, compareResult, label) {
  const payouts = airbnbData.payouts || [];

  // Suma de noches de todas las reservaciones de todos los payouts del mes
  const noches = payouts.reduce(
    (s, p) => s + (p.reservations || []).reduce(
      (ss, r) => ss + (parseInt(r.nights, 10) || 0), 0
    ), 0
  );

  // Comisión total de Airbnb (valor absoluto porque el CSV lo reporta negativo)
  const comision = payouts.reduce(
    (s, p) => s + (p.reservations || []).reduce(
      (ss, r) => ss + Math.abs(parseFloat(r.serviceFee) || 0), 0
    ), 0
  );

  const airbnbTotal = parseFloat(
    compareResult?.totals?.totalAirbnbPayouts  ||
    compareResult?.summary?.totalAirbnbPayouts ||
    compareResult?.summary?.airbnbTotal        || 0
  );

  return {
    reportLabel: compareResult.reportLabel || airbnbData.reportLabel || label,
    summary: {
      airbnbTotal,
      bankTotal:     compareResult?.totals?.totalBankDeposits || 0,
      matchRate:     compareResult?.totals?.matchRate         || '0%',
      netDifference: compareResult?.totals?.netDifference     || 0,
    },
    tables: {
      matched:      compareResult.matched      || [],
      onlyInAirbnb: compareResult.onlyInAirbnb || [],
      onlyInBank:   compareResult.onlyInBank   || [],
    },
    excelData: {
      noches,
      comisionAirbnb: parseFloat(comision.toFixed(2)),
      // IVA e ISR retenidos: calculados sobre el neto pagado por Airbnb
      ivaRetenido:    parseFloat((airbnbTotal * 0.08).toFixed(2)),
      isrRetenido:    parseFloat((airbnbTotal * 0.04).toFixed(2)),
    },
  };
}

// ── Procesador de un job individual ──────────────────────────────────────

async function processJob(job) {
  // Marcar como activo antes de empezar — el cliente ve 'active' en el polling
  queue.updateJob(job.id, { status: 'active' });

  const { userId, month, label, airbnbData, compareResult } = job.data;

  // ── Paso 1: buscar reporte del año anterior (para la Hoja 3 del Excel) ──
  let previousYearReport = null;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [year, mm] = month.split('-');
    const prevMonth  = `${parseInt(year, 10) - 1}-${mm}`;
    const prevRow    = await ReportRepository.findSummaryByMonthAny(userId, prevMonth);
    if (prevRow) {
      try {
        previousYearReport = typeof prevRow.summary === 'string'
          ? JSON.parse(prevRow.summary)
          : prevRow.summary;
      } catch (_) {
        // Si el JSON está corrupto, continuamos sin comparativa del año anterior
      }
    }
  }

  // ── Paso 2: construir payload para generateMonthlyAnalysis ──────────────
  const analysisData = buildAnalysisPayload(airbnbData, compareResult, label || month);

  // ── Paso 3: llamar a Claude API — la operación lenta (5–25 s) ────────────
  const analysisText = await generateMonthlyAnalysis(analysisData);

  // ── Paso 4: cachear el análisis en DB ────────────────────────────────────
  // Usamos findByMonthAny (no findSummaryByMonthAny) porque necesitamos el `id`
  // para updateSummary. findSummaryByMonthAny solo devuelve { summary }, sin id.
  const currentRow = await ReportRepository.findByMonthAny(userId, month);
  if (currentRow?.id) {
    try {
      const currentSummary = typeof currentRow.summary === 'string'
        ? JSON.parse(currentRow.summary)
        : (currentRow.summary || {});

      // Guardar el análisis cacheado para que futuros requests lo reusen
      currentSummary.cachedAnalysis   = analysisText;
      currentSummary.cachedAnalysisAt = new Date().toISOString();

      await ReportRepository.updateSummary(currentRow.id, JSON.stringify(currentSummary));
    } catch (_) {
      // El caché es un nice-to-have — si falla, continuamos igual.
      // El análisis está en job.result y el cliente lo puede descargar.
    }
  }

  // ── Paso 5: generar buffer Excel con el análisis como Hoja 4 ─────────────
  // Firma correcta: generateMonthlyReport(airbnbData, compareResult, previousYearReport, analysisText)
  const excelBuffer = await generateMonthlyReport(
    airbnbData,
    compareResult,
    previousYearReport,
    analysisText
  );

  // ── Paso 6: devolver resultado con buffer como base64 ─────────────────────
  // Usamos base64 para serializar el Buffer binario dentro del Map de la cola.
  // Al descargar, el jobs.controller lo convierte de vuelta a Buffer con Buffer.from().
  const reportLabel = compareResult.reportLabel || airbnbData.reportLabel || label || month;
  const safeLabel   = reportLabel.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim().replace(/\s+/g, '_');

  return {
    filename:    `Reporte_${month}_${safeLabel}.xlsx`,
    buffer:      excelBuffer.toString('base64'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ── Loop principal del worker ─────────────────────────────────────────────

/**
 * Loop de polling asíncrono. Usa setTimeout (no setInterval) para que el
 * próximo ciclo empiece solo DESPUÉS de que el ciclo actual terminó.
 * Con setInterval, si un job tarda 30 s y el intervalo es 2 s, habría 15
 * ciclos acumulados en la cola de eventos — el worker procesaría N jobs
 * en paralelo sin quererlo. setTimeout previene esto.
 */
function startWorker() {
  const tick = async () => {
    try {
      const job = queue.getNextPending();

      if (job) {
        try {
          const result = await processJob(job);
          queue.updateJob(job.id, { status: 'completed', result });
        } catch (jobError) {
          // Error específico del job — marcamos este job como fallido
          // pero el worker sigue vivo para el próximo job
          queue.updateJob(job.id, {
            status: 'failed',
            error:  jobError.message || 'Error desconocido al procesar el job',
          });
        }
      }

      // Limpiar jobs viejos (completados/fallidos con > 1 hora)
      queue.cleanup();

    } catch (unexpectedError) {
      // Error en la infraestructura (queue.getNextPending falla, etc.)
      // Logueamos pero no detenemos el worker
      console.error('[QUEUE] Error inesperado en el worker:', unexpectedError.message);
    }

    // Siguiente ciclo — siempre después de que este terminó
    setTimeout(tick, POLL_INTERVAL);
  };

  // Iniciar el primer ciclo
  tick();
  console.log(`[QUEUE] Worker de análisis iniciado — polling cada ${POLL_INTERVAL / 1000}s`);
}

module.exports = { startWorker };
