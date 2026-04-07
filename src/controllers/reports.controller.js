// reports.controller.js — Controlador del historial de reportes guardados
// Permite guardar, listar y recuperar reportes por mes del usuario autenticado

const { store }             = require('./upload.controller');
const annualExcelGenerator  = require('../services/annualExcelGenerator');
const PropRepo              = require('../repositories/PropertyRepository');
const ReportRepo            = require('../repositories/ReportRepository');

const MESES_ES = [
  '', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// ── Helpers ────────────────────────────────────────────────────

/**
 * extraerMonthKey — Obtiene la clave YYYY-MM del reporte
 * Intenta extraerla del campo reportMonth del summary, o lo deriva de las fechas.
 * @param {Object} report - JSON completo del reporte
 * @returns {{ monthKey: string, year: number, label: string }}
 */
function extraerMonthKey(report) {
  // Opción 1: el formatter ya incluye reportMonth en el summary
  if (report.summary && report.summary.reportMonth) {
    const monthKey = report.summary.reportMonth;  // "2026-02"
    const year     = parseInt(monthKey.substring(0, 4), 10);
    const label    = report.summary.reportLabel || report.summary.period?.airbnbMonth || monthKey;
    return { monthKey, year, label };
  }

  // Opción 2: derivar de airbnbFrom
  const airbnbFrom = report.summary?.period?.airbnbFrom;
  if (airbnbFrom && /^\d{4}-\d{2}/.test(airbnbFrom)) {
    const monthKey = airbnbFrom.substring(0, 7);
    const year     = parseInt(monthKey.substring(0, 4), 10);
    const label    = report.summary?.period?.airbnbMonth || monthKey;
    return { monthKey, year, label };
  }

  // Fallback: mes actual
  const now      = new Date();
  const mm       = String(now.getMonth() + 1).padStart(2, '0');
  const monthKey = `${now.getFullYear()}-${mm}`;
  return { monthKey, year: now.getFullYear(), label: monthKey };
}

// ── Controllers ────────────────────────────────────────────────

/**
 * saveReport — Guarda o sobreescribe el reporte del mes en la DB
 * Si ya existe un reporte para ese mes del usuario, lo reemplaza.
 * Body: JSON completo del reporte (salida de formatter.formatReport)
 */
async function saveReport(req, res) {
  try {
    const userId = req.user.userId;
    const report = req.body;

    if (!report || typeof report !== 'object') {
      return res.status(400).json({ error: 'El cuerpo de la petición no es un reporte válido' });
    }
    if (!report.summary) {
      return res.status(400).json({ error: 'El reporte no contiene el campo summary' });
    }

    // ── Resolver property_id ─────────────────────────────────────
    // El frontend envía propertyId en el body. Si no viene (ej: guardado antiguo),
    // se usa la primera propiedad del usuario. Si no tiene propiedades, se crea una.
    let propertyId = parseInt(report.propertyId, 10) || null;

    if (!propertyId) {
      const firstProp = await PropRepo.findFirstByUser(userId);

      if (firstProp) {
        propertyId = firstProp.id;
      } else {
        // Crear propiedad por defecto si el usuario no tiene ninguna
        propertyId = await PropRepo.createDefault(userId);
        console.log(`[reports] Propiedad por defecto creada para user=${userId}`);
      }
    } else {
      // Verificar que la propiedad pertenece al usuario
      const prop = await PropRepo.findByIdAndUser(propertyId, userId);
      if (!prop) {
        return res.status(400).json({ error: 'Propiedad no válida' });
      }
    }

    // ── Construir excelData desde múltiples fuentes ──────────────
    // Permite que el reporte anual tenga datos de noches, IVA e ISR retenidos.
    // Siempre se adjunta: si el store está vacío se usan los datos del propio body.
    const reportToSave = { ...report };

    let noches = 0, comisionAirbnb = 0;
    let dataSource = 'none';

    // Fuente 1: store.airbnbData en memoria (más preciso — incluye noches y comisión real)
    if (store.airbnbData?.payouts?.length > 0) {
      const payouts = store.airbnbData.payouts;
      noches = payouts.reduce((sum, p) =>
        sum + (p.reservations || []).reduce((s, r) =>
          s + (parseInt(r.nights, 10) || 0), 0), 0);
      comisionAirbnb = payouts.reduce((sum, p) =>
        sum + (p.reservations || []).reduce((s, r) =>
          s + (parseFloat(r.serviceFee) || 0), 0), 0);
      dataSource = 'store';
    }

    // Fuente 2: tables.matched en el body (fallback — comisión si estaba guardada en el JSON)
    if (comisionAirbnb === 0 && report.tables?.matched?.length > 0) {
      comisionAirbnb = report.tables.matched.reduce((sum, m) =>
        sum + (parseFloat(m.serviceFee) || parseFloat(m.comision) || 0), 0);
      if (dataSource === 'none') dataSource = 'tables';
    }

    // Fuente 3: rawAirbnb en el body (fallback para noches cuando el store no está disponible)
    if (noches === 0 && Array.isArray(report.rawAirbnb?.payouts)) {
      noches = report.rawAirbnb.payouts.reduce((sum, p) =>
        sum + (p.reservations || []).reduce((s, r) =>
          s + (parseInt(r.nights, 10) || 0), 0), 0);
      dataSource = dataSource === 'tables' ? 'tables+rawAirbnb' : 'rawAirbnb';
    }

    // IVA (8%) e ISR (4%) calculados desde el neto pagado del reporte
    // El campo correcto es summary.airbnbTotal (no totalAirbnbPayouts)
    const totalBruto   = parseFloat(report.summary?.airbnbTotal || report.summary?.totalAirbnbPayouts || 0);
    const ivaRetenido  = parseFloat((totalBruto * 0.08).toFixed(2));
    const isrRetenido  = parseFloat((totalBruto * 0.04).toFixed(2));

    reportToSave.excelData = {
      noches,
      comisionAirbnb: parseFloat(comisionAirbnb.toFixed(2)),
      ivaRetenido,
      isrRetenido,
    };

    console.log(
      `[reports] excelData (fuente: ${dataSource}):`,
      `noches=${noches}`,
      `comision=${comisionAirbnb.toFixed(2)}`,
      `IVA=${ivaRetenido}`,
      `ISR=${isrRetenido}`
    );

    const { monthKey, year, label } = extraerMonthKey(reportToSave);

    // INSERT OR REPLACE (actualiza si ya existe ese (usuario, propiedad, mes))
    await ReportRepo.upsert(userId, propertyId, monthKey, year, label, JSON.stringify(reportToSave));

    console.log(`[reports] Reporte guardado: usuario=${userId}, propiedad=${propertyId}, mes=${monthKey}`);

    // ── Detectar reporte del año siguiente que referencia este mes ─
    const [savedYear, savedMonthNum] = monthKey.split('-').map(Number);
    const nextYearMonth  = `${savedYear + 1}-${String(savedMonthNum).padStart(2, '0')}`;
    const nextYearReport = await ReportRepo.findNextYearEntry(userId, propertyId, nextYearMonth);
    const canUpdateNextYear = !!nextYearReport;

    return res.json({
      success:           true,
      message:           `Reporte guardado para ${label}`,
      month:             monthKey,
      canUpdateNextYear,
      nextYearMonth:     canUpdateNextYear ? nextYearMonth          : null,
      nextYearLabel:     canUpdateNextYear ? nextYearReport.label   : null,
    });

  } catch (err) {
    console.error('[reports] Error en saveReport:', err.message);
    return res.status(500).json({ error: 'Error al guardar el reporte' });
  }
}

/**
 * listReports — Lista los reportes de una propiedad (metadatos + totales clave)
 * Acepta query param ?propertyId=N para filtrar por propiedad.
 * Si no se indica, devuelve todos los reportes del usuario (compatible con legado).
 * Ordenados por mes descendente (más reciente primero).
 */
async function listReports(req, res) {
  try {
    const userId     = req.user.userId;
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    const rows = propertyId
      ? await ReportRepo.listByProperty(userId, propertyId)
      : await ReportRepo.listByUser(userId);

    const reportList = rows.map(r => {
      let airbnbTotal = 0;
      let matchRate   = '0%';

      try {
        const parsed = JSON.parse(r.summary);
        // El summary guardado es el full report (salida de formatReport).
        // La sección .summary contiene los totales formateados.
        const s = parsed?.summary;
        airbnbTotal = s?.totalAirbnbPayouts ?? s?.totals?.airbnbPayouts ?? 0;
        matchRate   = s?.matchRate ?? '0%';
      } catch (_) { /* JSON inválido: dejar valores por defecto */ }

      const yearNum = r.year || parseInt(r.month.substring(0, 4), 10);

      return {
        id:          r.id,
        month:       r.month,
        year:        yearNum,
        label:       r.label,
        createdAt:   r.created_at,
        airbnbTotal,
        matchRate,
      };
    });

    return res.json({ reports: reportList });

  } catch (err) {
    console.error('[reports] Error en listReports:', err.message);
    return res.status(500).json({ error: 'Error al listar reportes' });
  }
}

/**
 * getReport — Devuelve el JSON completo de un reporte por mes
 * Param de ruta: :month en formato YYYY-MM (ej: "2026-02")
 * Query param opcional: ?propertyId=N para filtrar a una propiedad específica.
 */
async function getReport(req, res) {
  try {
    const userId     = req.user.userId;
    const { month }  = req.params;
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    // Validar formato del mes
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM (ej: 2026-02)' });
    }

    const row = propertyId
      ? await ReportRepo.findSummaryByMonth(userId, propertyId, month)
      : await ReportRepo.findSummaryByMonthAny(userId, month);

    if (!row) {
      return res.status(404).json({ error: `No se encontró reporte guardado para ${month}` });
    }

    // Parsear el JSON guardado y devolverlo
    const report = JSON.parse(row.summary);
    return res.json(report);

  } catch (err) {
    console.error('[reports] Error en getReport:', err.message);
    return res.status(500).json({ error: 'Error al recuperar el reporte' });
  }
}

/**
 * generateAnnualReport — Genera y descarga el Excel anual para un año dado
 * Consolida los reportes del año filtrados por propiedad.
 * GET /api/reports/annual/:year?propertyId=N
 */
async function generateAnnualReport(req, res) {
  try {
    const userId     = req.user.userId;
    const year       = parseInt(req.params.year, 10);
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    if (!year || year < 2020 || year > 2030) {
      return res.status(400).json({ error: 'Año inválido. Debe estar entre 2020 y 2030.' });
    }

    // Nombre de la propiedad para el filename (si se filtra)
    let propertyName = '';
    if (propertyId) {
      const prop = await PropRepo.findNameByIdAndUser(propertyId, userId);
      if (prop) propertyName = prop.name;
    }

    // ── Obtener reportes del año (filtrados por propiedad si se indica) ─
    const rows = propertyId
      ? await ReportRepo.findByYear(userId, propertyId, year)
      : await ReportRepo.findByYearAll(userId, year);

    if (rows.length === 0) {
      return res.status(404).json({ error: `No hay reportes guardados para ${year}` });
    }

    // ── Parsear cada reporte y extraer datos clave ──────────────
    const monthlyData = rows.map(r => {
      let s = {};
      try { s = JSON.parse(r.summary); } catch (_) {}

      const sum        = s?.summary  || {};
      const tables     = s?.tables   || {};
      const excelData  = s?.excelData;          // undefined cuando no fue guardado
      const excel      = excelData   || {};

      const airbnbTotal = sum.totalAirbnbPayouts || sum.totals?.airbnbPayouts || 0;

      // Ingresos brutos = suma de airbnbAmount de los payouts coincidentes
      const grossIncome = (tables.matched || s.matched || [])
        .reduce((acc, m) => acc + (m.airbnbAmount || 0), 0);

      // IVA/ISR: usar valor guardado si existe; calcular como % del neto si no
      const ivaRetenido    = excel.ivaRetenido    != null
                           ? excel.ivaRetenido
                           : parseFloat((airbnbTotal * 0.08).toFixed(2));
      const isrRetenido    = excel.isrRetenido    != null
                           ? excel.isrRetenido
                           : parseFloat((airbnbTotal * 0.04).toFixed(2));
      // Comisión Airbnb: 1) excelData guardado, 2) serviceFee de reservaciones en matched, 3) aprox 3.5%
      let comisionAirbnb = excel.comisionAirbnb || 0;
      if (!comisionAirbnb) {
        const matchedRows = tables.matched || s.matched || [];
        comisionAirbnb = matchedRows.reduce((sum, m) =>
          sum + (m.serviceFee || m.comision || 0), 0);
      }
      if (!comisionAirbnb && airbnbTotal > 0) {
        comisionAirbnb = parseFloat((airbnbTotal * 0.035).toFixed(2));
      }

      const noches = excel.noches != null ? excel.noches : null; // null = sin datos

      return {
        month:          r.month,
        label:          r.label,
        airbnbTotal,
        bankTotal:      sum.totalBankDeposits || sum.totals?.bankDepositsMonth || 0,
        matchRate:      sum.matchRate         || '0%',
        payoutsCount:   sum.payoutsCount      || 0,
        grossIncome,
        noches,
        comisionAirbnb,
        ivaRetenido,
        isrRetenido,
        hasExcelData:   !!excelData,
      };
    });

    // ── Obtener reportes del año anterior para comparativa ──────
    const prevYear = year - 1;
    const prevRows = propertyId
      ? await ReportRepo.findSummaryByYear(userId, propertyId, prevYear)
      : await ReportRepo.findSummaryByYearAll(userId, prevYear);

    const prevData = {};
    prevRows.forEach(r => {
      let s = {};
      try { s = JSON.parse(r.summary); } catch (_) {}
      const mm = r.month.split('-')[1];  // '01'–'12'
      prevData[mm] = {
        airbnbTotal: s?.summary?.totalAirbnbPayouts || s?.summary?.totals?.airbnbPayouts || 0,
        noches:      s?.excelData?.noches || 0,
      };
    });

    // ── Detectar meses faltantes ────────────────────────────────
    const mesesGuardados  = rows.map(r => r.month.split('-')[1]);
    const todosMeses      = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const mesesFaltantes  = todosMeses.filter(m => !mesesGuardados.includes(m));

    const propTag = propertyName
      ? ` [${propertyName}]`
      : '';
    console.log(`[reports] Reporte anual ${year}${propTag}: ${rows.length} meses, ${mesesFaltantes.length} faltantes`);

    // ── Intentar generar análisis IA anual ─────────────────────
    let annualAnalysisText = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const { generateAnnualAnalysis } = require('../services/analysisGenerator');
        const analysisInput = monthlyData.map(d => ({
          label:       d.label,
          airbnbTotal: d.airbnbTotal,
          noches:      d.noches,
          matchRate:   d.matchRate,
        }));
        annualAnalysisText = await generateAnnualAnalysis(analysisInput, year);
        console.log(`[reports] Análisis IA anual generado para ${year}`);
      } catch (analysisErr) {
        console.warn('[reports] Análisis IA anual no disponible:', analysisErr.message);
      }
    }

    // ── Generar Excel ───────────────────────────────────────────
    const buffer = await annualExcelGenerator.generateAnnualReport({
      year,
      monthlyData,
      prevData,
      prevYear,
      mesesFaltantes,
      analysisText: annualAnalysisText,
    });

    const safePropName = propertyName
      ? `_${propertyName.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().replace(/\s+/g, '_')}`
      : '';
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="Reporte_Anual_${year}${safePropName}.xlsx"`);
    res.send(buffer);

  } catch (err) {
    console.error('[reports] Error en generateAnnualReport:', err.message);
    res.status(500).json({ error: `Error al generar el reporte anual: ${err.message}` });
  }
}

/**
 * deleteReport — Elimina un reporte específico por mes y propiedad
 * DELETE /api/reports/:month?propertyId=N
 */
async function deleteReport(req, res) {
  try {
    const userId     = req.user.userId;
    const { month }  = req.params;
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM' });
    }

    // Resolver property_id: parámetro → primera propiedad del usuario
    let resolvedPropertyId = propertyId;
    if (!resolvedPropertyId) {
      const firstProp = await PropRepo.findFirstByUser(userId);
      resolvedPropertyId = firstProp?.id ?? null;
    }

    const changes = resolvedPropertyId
      ? await ReportRepo.remove(userId, resolvedPropertyId, month)
      : await ReportRepo.removeAny(userId, month);

    if (changes === 0) {
      return res.status(404).json({ error: `No se encontró reporte para ${month}` });
    }

    console.log(`[reports] Reporte eliminado: usuario=${userId}, propiedad=${resolvedPropertyId}, mes=${month}`);
    return res.json({ success: true, message: `Reporte ${month} eliminado` });

  } catch (err) {
    console.error('[reports] Error en deleteReport:', err.message);
    return res.status(500).json({ error: 'Error al eliminar el reporte' });
  }
}

/**
 * updatePrevYearRef — Inyecta los datos del año anterior en un reporte futuro
 * Cuando el usuario guarda el reporte de mes X año Y, y ya existe el mes X año Y+1,
 * esta función copia los totales clave de Y→X al campo summary.prevYearData de Y+1→X.
 * Así, cuando se genere el Excel de Y+1→X, Sheet 3 ya tiene datos reales del año anterior.
 *
 * POST /api/reports/update-prev-year-ref
 * Body: { targetMonth: "YYYY-MM", propertyId: N }
 */
async function updatePrevYearRef(req, res) {
  try {
    const userId = req.user.userId;
    const { targetMonth, propertyId: propIdFromBody } = req.body;

    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) {
      return res.status(400).json({ error: 'targetMonth inválido. Use formato YYYY-MM' });
    }

    // ── Resolver property_id ─────────────────────────────────────
    let propertyId = parseInt(propIdFromBody, 10) || null;
    if (!propertyId) {
      const firstProp = await PropRepo.findFirstByUser(userId);
      propertyId = firstProp?.id ?? null;
    } else {
      const prop = await PropRepo.findByIdAndUser(propertyId, userId);
      if (!prop) return res.status(400).json({ error: 'Propiedad no válida' });
    }

    // ── Calcular mes fuente (= targetMonth − 1 año) ──────────────
    const [targetYear, targetMM] = targetMonth.split('-').map(Number);
    const sourceMonth = `${targetYear - 1}-${String(targetMM).padStart(2, '0')}`;

    // ── Leer reporte fuente (el que se acaba de guardar) ─────────
    const sourceRow = await ReportRepo.findSummaryByMonth(userId, propertyId, sourceMonth);

    if (!sourceRow) {
      return res.status(404).json({
        error: `No se encontró el reporte fuente para ${sourceMonth}`,
      });
    }

    // ── Leer reporte destino (el del año siguiente) ──────────────
    const targetRow = await ReportRepo.findByMonth(userId, propertyId, targetMonth);

    if (!targetRow) {
      return res.status(404).json({
        error: `No se encontró el reporte destino para ${targetMonth}`,
      });
    }

    // ── Parsear ambos ────────────────────────────────────────────
    let sourceReport = {};
    let targetReport = {};
    try { sourceReport = JSON.parse(sourceRow.summary); } catch (_) {}
    try { targetReport = JSON.parse(targetRow.summary); } catch (_) {}

    const s = sourceReport.summary || {};

    // ── Construir prevYearData con los campos que Sheet 3 necesita ─
    const prevYearData = {
      month:              sourceMonth,
      totalAirbnbPayouts: s.totalAirbnbPayouts  || s.airbnbTotal || 0,
      totalBankDeposits:  s.totalBankDeposits   || s.bankTotal   || 0,
      matchRate:          s.matchRate           || '0%',
      payoutsCount:       s.payoutsCount        || 0,
      matchedCount:       s.matchedCount        || 0,
      onlyAirbnbCount:    s.onlyAirbnbCount     || 0,
      onlyBankCount:      s.onlyBankCount       || 0,
      noches:             sourceReport.excelData?.noches || 0,
    };

    // ── Inyectar en el summary del reporte destino ───────────────
    targetReport.summary              = targetReport.summary || {};
    targetReport.summary.prevYearData = prevYearData;

    await ReportRepo.updateSummary(targetRow.id, JSON.stringify(targetReport), true);

    const mesNombre = MESES_ES[targetMM] || targetMonth;
    console.log(`[reports] prevYearData inyectado: fuente=${sourceMonth} → destino=${targetMonth} (propiedad=${propertyId})`);

    return res.json({
      success:      true,
      message:      `Datos del año anterior actualizados en el reporte de ${mesNombre} ${targetYear}`,
      targetMonth,
      sourceMonth,
    });

  } catch (err) {
    console.error('[reports] Error en updatePrevYearRef:', err.message);
    return res.status(500).json({ error: 'Error al actualizar referencia del año anterior' });
  }
}

/**
 * _buildAnalysisData — Construye el objeto de datos para generateMonthlyAnalysis
 * a partir del JSON de un reporte guardado en DB.
 * @param {Object} reportData  JSON parseado del campo summary
 * @returns {Object} data compatible con generateMonthlyAnalysis
 */
function _buildAnalysisData(reportData) {
  const sum        = reportData?.summary || {};
  const excelData  = reportData?.excelData || {};
  const airbnbTotal = parseFloat(
    sum.airbnbTotal || sum.totalAirbnbPayouts || sum.totals?.airbnbPayouts || 0
  );
  return {
    reportLabel:  reportData?.summary?.reportLabel || reportData?.reportLabel || '—',
    summary: {
      airbnbTotal,
      bankTotal:     sum.bankTotal     || sum.totalBankDeposits  || sum.totals?.bankDepositsMonth || 0,
      matchRate:     sum.matchRate     || '0%',
      netDifference: sum.netDifference || 0,
    },
    tables: {
      matched:      reportData?.tables?.matched      || reportData?.matched      || [],
      onlyInAirbnb: reportData?.tables?.onlyInAirbnb || reportData?.onlyInAirbnb || [],
      onlyInBank:   reportData?.tables?.onlyInBank   || reportData?.onlyInBank   || [],
    },
    excelData: {
      noches:         excelData.noches         || 0,
      comisionAirbnb: excelData.comisionAirbnb || parseFloat((airbnbTotal * 0.035).toFixed(2)),
      ivaRetenido:    excelData.ivaRetenido    || parseFloat((airbnbTotal * 0.08).toFixed(2)),
      isrRetenido:    excelData.isrRetenido    || parseFloat((airbnbTotal * 0.04).toFixed(2)),
    },
  };
}

/**
 * getAnalysisFromSaved — Genera el análisis IA de un reporte guardado en DB.
 * Cachea el resultado en el JSON del reporte para evitar llamadas repetidas a la API.
 * POST /api/reports/:month/analysis?propertyId=N[&force=true]
 */
async function getAnalysisFromSaved(req, res) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY no está configurada en el servidor. Agrega la variable en el archivo .env' });
    }

    const userId     = req.user.userId;
    const { month }  = req.params;
    const propertyId = parseInt(req.query.propertyId, 10) || null;
    const forceRegen = req.query.force === 'true';

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM' });
    }

    const row = propertyId
      ? await ReportRepo.findByMonth(userId, propertyId, month)
      : await ReportRepo.findByMonthAny(userId, month);

    if (!row) return res.status(404).json({ error: `No se encontró reporte para ${month}` });

    const reportData = JSON.parse(row.summary);

    // ── Devolver análisis cacheado si existe y no se fuerza regeneración ──
    if (reportData.cachedAnalysis && !forceRegen) {
      console.log(`[analysis] Usando análisis cacheado para ${month}`);
      return res.json({
        success:    true,
        analysis:   reportData.cachedAnalysis,
        cached:     true,
        cachedAt:   reportData.cachedAnalysisAt,
      });
    }

    // ── Generar nuevo análisis ────────────────────────────────────────
    const analysisData = _buildAnalysisData(reportData);
    const { generateMonthlyAnalysis } = require('../services/analysisGenerator');
    const analysis = await generateMonthlyAnalysis(analysisData);

    // ── Persistir en DB ───────────────────────────────────────────────
    reportData.cachedAnalysis   = analysis;
    reportData.cachedAnalysisAt = new Date().toISOString();
    await ReportRepo.updateSummary(row.id, JSON.stringify(reportData));

    console.log(`[analysis] Análisis generado y cacheado para ${month}`);
    return res.json({ success: true, analysis, cached: false });

  } catch (err) {
    console.error('[analysis] Error desde guardado:', err.message);
    return res.status(500).json({ error: `Error al generar el análisis: ${err.message}` });
  }
}

/**
 * getAnalysisPDFFromSaved — Descarga el análisis de un reporte guardado como PDF
 * POST /api/reports/:month/analysis/pdf?propertyId=N
 */
async function getAnalysisPDFFromSaved(req, res) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY no está configurada' });
    }

    const userId     = req.user.userId;
    const { month }  = req.params;
    const propertyId = parseInt(req.query.propertyId, 10) || null;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Formato de mes inválido. Use YYYY-MM' });
    }

    const row = propertyId
      ? await ReportRepo.findByMonth(userId, propertyId, month)
      : await ReportRepo.findByMonthAny(userId, month);

    if (!row) return res.status(404).json({ error: `No se encontró reporte para ${month}` });

    const reportData   = JSON.parse(row.summary);
    const analysisData = _buildAnalysisData(reportData);
    const reportLabel  = analysisData.reportLabel;

    // ── Usar caché si existe, sino generar y persistir ────────────
    let analysisText;
    if (reportData.cachedAnalysis) {
      analysisText = reportData.cachedAnalysis;
      console.log(`[analysis-pdf] Usando análisis cacheado para ${month}`);
    } else {
      const { generateMonthlyAnalysis } = require('../services/analysisGenerator');
      analysisText = await generateMonthlyAnalysis(analysisData);
      reportData.cachedAnalysis   = analysisText;
      reportData.cachedAnalysisAt = new Date().toISOString();
      await ReportRepo.updateSummary(row.id, JSON.stringify(reportData));
      console.log(`[analysis-pdf] Análisis generado y cacheado para ${month}`);
    }

    const PDFDocument = require('pdfkit');
    const safeLabel   = reportLabel.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Analisis_${safeLabel}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold')
       .text(`Análisis Financiero — ${reportLabel}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica')
       .text(`Generado el ${new Date().toLocaleDateString('es-MX')} con IA (Claude)`, { align: 'center' });
    doc.moveDown(2);

    analysisText.split('\n').forEach(line => {
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
    console.error('[analysis] Error PDF desde guardado:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Error al generar el PDF: ${err.message}` });
    }
  }
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

/**
 * getDashboard — Métricas anuales consolidadas para el dashboard.
 * GET /api/reports/dashboard/:year?propertyId=N
 */
async function getDashboard(req, res) {
  try {
    const userId     = req.user.userId;
    const year       = parseInt(req.params.year);
    const prevYear   = year - 1;

    // Resolver propertyId (query param o primera propiedad del usuario)
    let propertyId = parseInt(req.query.propertyId, 10) || null;
    if (!propertyId) {
      const firstProp = await PropRepo.findFirstByUser(userId);
      propertyId = firstProp ? firstProp.id : null;
    }
    if (!propertyId) return res.json({ success: true, mesesActivos: 0 });

    // Reportes del año actual
    const reportes     = await ReportRepo.findByMonthLike(userId, propertyId, `${year}-%`);

    // Reportes del año anterior
    const reportesPrev = await ReportRepo.findByMonthLike(userId, propertyId, `${prevYear}-%`);

    // Métricas año actual
    let ingresoTotal    = 0;
    let nochesTotal     = 0;
    let mesesActivos    = 0;
    let mejorMes        = null;
    let mejorMesIngreso = 0;

    reportes.forEach(r => {
      const s = JSON.parse(r.summary || '{}');
      const ingreso = parseFloat(
        s?.summary?.totalAirbnbPayouts ||
        s?.summary?.totals?.airbnbPayouts ||
        s?.summary?.airbnbTotal ||
        0
      );
      const noches = parseInt(s?.excelData?.noches || 0);

      ingresoTotal += ingreso;
      nochesTotal  += noches;
      if (ingreso > 0) mesesActivos++;
      if (ingreso > mejorMesIngreso) {
        mejorMesIngreso = ingreso;
        mejorMes = r.month;
      }
    });

    // Métricas año anterior
    let ingresoTotalPrev = 0;
    let nochesPrev       = 0;
    let mesesActivosPrev = 0;
    reportesPrev.forEach(r => {
      const s = JSON.parse(r.summary || '{}');
      const ingreso = parseFloat(
        s?.summary?.totalAirbnbPayouts ||
        s?.summary?.totals?.airbnbPayouts ||
        s?.summary?.airbnbTotal ||
        0
      );
      const noches = parseInt(s?.excelData?.noches || 0);
      ingresoTotalPrev += ingreso;
      nochesPrev       += noches;
      if (ingreso > 0) mesesActivosPrev++;
    });

    // Indicadores calculados
    const diasDisponibles = mesesActivos * 30;
    const ocupacion = diasDisponibles > 0
      ? parseFloat(((nochesTotal / diasDisponibles) * 100).toFixed(1))
      : 0;
    const adr = nochesTotal > 0
      ? parseFloat((ingresoTotal / nochesTotal).toFixed(2))
      : 0;

    // Variaciones YoY — comparar promedios mensuales para ser justo
    // entre años con distinto número de meses activos
    const promActual       = mesesActivos       > 0 ? ingresoTotal       / mesesActivos       : 0;
    const promPrev         = mesesActivosPrev   > 0 ? ingresoTotalPrev   / mesesActivosPrev   : 0;
    const promNochesActual = mesesActivos       > 0 ? nochesTotal        / mesesActivos       : 0;
    const promNochesPrev   = mesesActivosPrev   > 0 ? nochesPrev         / mesesActivosPrev   : 0;

    const varIngreso = promPrev > 0
      ? parseFloat(((promActual - promPrev) / promPrev * 100).toFixed(1))
      : null;
    const varNoches = promNochesPrev > 0
      ? parseFloat(((promNochesActual - promNochesPrev) / promNochesPrev * 100).toFixed(1))
      : null;

    const mejorMesLabel = mejorMes
      ? MESES[parseInt(mejorMes.split('-')[1]) - 1] + ' ' + year
      : null;

    // Desglose mensual para la gráfica
    const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun',
                          'Jul','Ago','Sep','Oct','Nov','Dic'];
    const mesesData = MESES_CORTOS.map((label, i) => {
      const monthKey     = `${year}-${String(i + 1).padStart(2, '0')}`;
      const monthKeyPrev = `${prevYear}-${String(i + 1).padStart(2, '0')}`;
      const rActual = reportes.find(r => r.month === monthKey);
      const rPrev   = reportesPrev.find(r => r.month === monthKeyPrev);
      const sActual = rActual ? JSON.parse(rActual.summary || '{}') : null;
      const sPrev   = rPrev   ? JSON.parse(rPrev.summary   || '{}') : null;
      const ingresoActual = sActual ? parseFloat(
        sActual?.summary?.totalAirbnbPayouts ||
        sActual?.summary?.totals?.airbnbPayouts || 0
      ) : 0;
      const ingresoPrev = sPrev ? parseFloat(
        sPrev?.summary?.totalAirbnbPayouts ||
        sPrev?.summary?.totals?.airbnbPayouts || 0
      ) : 0;
      return {
        mes:           label,
        actual:        parseFloat(ingresoActual.toFixed(2)),
        anterior:      parseFloat(ingresoPrev.toFixed(2)),
        tieneActual:   !!rActual,
        tieneAnterior: !!rPrev,
      };
    });

    res.json({
      success:      true,
      year,
      prevYear,
      mesesActivos,
      metricas: {
        ingresoTotal:    parseFloat(ingresoTotal.toFixed(2)),
        nochesTotal,
        ocupacion,
        adr,
        mejorMes:        mejorMesLabel,
        mejorMesIngreso: parseFloat(mejorMesIngreso.toFixed(2)),
      },
      variaciones: { ingreso: varIngreso, noches: varNoches },
      prevYearData: {
        ingresoTotal:  parseFloat(ingresoTotalPrev.toFixed(2)),
        nochesTotal:   nochesPrev,
        mesesActivos:  mesesActivosPrev,
      },
      mesesData,
    });
  } catch (err) {
    console.error('[dashboard] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getExecutivePDF(req, res) {
  try {
    const userId = req.user.userId;
    const year   = parseInt(req.params.year);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: {
        Title:  `Reporte Ejecutivo ${year} — Airbnb Finance`,
        Author: 'Airbnb Finance Assistant',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Reporte_Ejecutivo_${year}.pdf"`);
    doc.pipe(res);

    const CORAL = '#FF5A5F';
    const INK   = '#0F0F0F';
    const INK60 = '#6B6B6B';
    const INK20 = '#E8E8E8';
    const GREEN = '#1A7A4A';
    const BLUE  = '#1F4E79';

    const MESES_PDF = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                       'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    const fmtMXN = n => '$' + Number(n).toLocaleString('es-MX', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }) + ' MXN';

    const propiedades = await PropRepo.findAllByUserOrderedByCreation(userId);

    if (propiedades.length === 0) {
      doc.fontSize(12).text('No hay propiedades registradas.');
      doc.end();
      return;
    }

    const consolidado = { ingresoTotal: 0, nochesTotal: 0, mesesActivos: 0, propiedades: [] };

    for (let propIdx = 0; propIdx < propiedades.length; propIdx++) {
      const prop = propiedades[propIdx];
      if (propIdx > 0) doc.addPage();

      // Header negro
      doc.rect(0, 0, doc.page.width, 80).fill(INK);
      doc.fill(CORAL).fontSize(18).font('Helvetica-Bold')
         .text('✦ Airbnb Finance Assistant', 50, 20);
      doc.fill('white').fontSize(10).font('Helvetica')
         .text(`Reporte Ejecutivo ${year}`, 50, 45);
      doc.fill(CORAL).fontSize(10).font('Helvetica')
         .text(prop.name, doc.page.width - 200, 45, { width: 150, align: 'right' });
      doc.rect(0, 78, doc.page.width, 2).fill(CORAL);

      doc.moveDown(3);
      doc.fill(INK).fontSize(22).font('Helvetica-Bold').text(prop.name);
      doc.fill(INK60).fontSize(10).font('Helvetica')
         .text(`Reporte de ingresos y conciliación — ${year}`);
      doc.moveDown(1.5);

      const reportes = await ReportRepo.findByMonthLike(userId, prop.id, `${year}-%`);

      if (reportes.length === 0) {
        doc.fill(INK60).fontSize(11).font('Helvetica')
           .text('Sin reportes registrados para este año.');
        consolidado.propiedades.push({ name: prop.name, ingresoTotal: 0, noches: 0, meses: 0, adr: 0, ocupacion: 0 });
        continue;
      }

      let ingresoTotal = 0, nochesTotal = 0, mesesActivos = 0;
      let mejorMes = null, mejorIngreso = 0;
      const mesesData = [];

      reportes.forEach(r => {
        const s       = JSON.parse(r.summary || '{}');
        const ingreso = parseFloat(s?.summary?.totalAirbnbPayouts || s?.summary?.totals?.airbnbPayouts || 0);
        const noches  = parseInt(s?.excelData?.noches || 0);
        const matchRate = s?.summary?.matchRate || '0%';
        const label   = MESES_PDF[parseInt(r.month.split('-')[1]) - 1];

        ingresoTotal += ingreso;
        nochesTotal  += noches;
        if (ingreso > 0) mesesActivos++;
        if (ingreso > mejorIngreso) { mejorIngreso = ingreso; mejorMes = label; }
        mesesData.push({ label, ingreso, noches, matchRate });
      });

      const adr      = nochesTotal > 0 ? (ingresoTotal / nochesTotal).toFixed(2) : 0;
      const ocupacion = mesesActivos > 0
        ? ((nochesTotal / (mesesActivos * 30)) * 100).toFixed(1) : 0;

      // KPIs
      const kpis = [
        { label: 'Ingresos netos',  value: fmtMXN(ingresoTotal) },
        { label: 'Noches ocupadas', value: nochesTotal + ' noches' },
        { label: 'Ocupación',       value: ocupacion + '%' },
        { label: 'ADR',             value: fmtMXN(adr) },
      ];
      const boxW = (doc.page.width - 100 - 30) / 4;
      const boxH = 55;
      const boxY = doc.y;

      kpis.forEach((kpi, i) => {
        const x = 50 + i * (boxW + 10);
        doc.rect(x, boxY, boxW, boxH).lineWidth(1).strokeColor(INK20).stroke();
        doc.fill(INK60).fontSize(8).font('Helvetica')
           .text(kpi.label.toUpperCase(), x + 8, boxY + 8, { width: boxW - 16 });
        doc.fill(CORAL).fontSize(13).font('Helvetica-Bold')
           .text(kpi.value, x + 8, boxY + 24, { width: boxW - 16 });
      });

      doc.moveDown(4.5);

      // Tabla mensual
      doc.fill(INK).fontSize(11).font('Helvetica-Bold').text('Detalle mensual');
      doc.moveDown(0.5);

      const cols  = { mes: 50, ingreso: 180, noches: 340, match: 430 };
      const rowH  = 22;
      const tableY = doc.y;

      doc.rect(50, tableY, doc.page.width - 100, rowH).fill(INK);
      doc.fill('white').fontSize(8).font('Helvetica-Bold')
         .text('MES',      cols.mes,    tableY + 7)
         .text('INGRESOS', cols.ingreso, tableY + 7)
         .text('NOCHES',   cols.noches,  tableY + 7)
         .text('MATCH',    cols.match,   tableY + 7);

      let rowY = tableY + rowH;

      mesesData.forEach((m, i) => {
        const bg = i % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
        doc.rect(50, rowY, doc.page.width - 100, rowH).fill(bg);
        const pct = parseFloat(m.matchRate) || 0;
        const matchColor = pct >= 95 ? GREEN : pct >= 80 ? '#B45309' : '#DC2626';
        doc.fill(INK).fontSize(9).font('Helvetica')
           .text(m.label,           cols.mes,    rowY + 6)
           .text(fmtMXN(m.ingreso), cols.ingreso, rowY + 6)
           .text(m.noches + ' n.',  cols.noches,  rowY + 6);
        doc.fill(matchColor).fontSize(9).font('Helvetica-Bold')
           .text(m.matchRate, cols.match, rowY + 6);
        rowY += rowH;
      });

      doc.rect(50, rowY, doc.page.width - 100, rowH).fill(BLUE);
      doc.fill('white').fontSize(9).font('Helvetica-Bold')
         .text('TOTAL',               cols.mes,    rowY + 6)
         .text(fmtMXN(ingresoTotal),  cols.ingreso, rowY + 6)
         .text(nochesTotal + ' n.',   cols.noches,  rowY + 6);

      rowY += rowH + 20;
      doc.y = rowY;

      if (mejorMes) {
        doc.fill(INK60).fontSize(9).font('Helvetica')
           .text(`Mejor mes: ${mejorMes} con ${fmtMXN(mejorIngreso)}`);
      }

      consolidado.ingresoTotal += ingresoTotal;
      consolidado.nochesTotal  += nochesTotal;
      consolidado.mesesActivos  = Math.max(consolidado.mesesActivos, mesesActivos);
      consolidado.propiedades.push({ name: prop.name, ingresoTotal, noches: nochesTotal, meses: mesesActivos, adr, ocupacion });
    }

    // ── Página resumen consolidado ──
    doc.addPage();

    doc.rect(0, 0, doc.page.width, 80).fill(INK);
    doc.fill(CORAL).fontSize(18).font('Helvetica-Bold')
       .text('✦ Airbnb Finance Assistant', 50, 20);
    doc.fill('white').fontSize(10).font('Helvetica')
       .text(`Resumen Consolidado ${year}`, 50, 45);
    doc.rect(0, 78, doc.page.width, 2).fill(CORAL);

    doc.moveDown(3);
    doc.fill(INK).fontSize(22).font('Helvetica-Bold').text('Resumen Consolidado');
    doc.fill(INK60).fontSize(10).font('Helvetica').text(`Todas las propiedades — ${year}`);
    doc.moveDown(1.5);

    const totalADR = consolidado.nochesTotal > 0
      ? (consolidado.ingresoTotal / consolidado.nochesTotal).toFixed(2) : 0;

    const kpisC = [
      { label: 'Ingresos totales',    value: fmtMXN(consolidado.ingresoTotal) },
      { label: 'Total noches',         value: consolidado.nochesTotal + ' noches' },
      { label: 'ADR consolidado',      value: fmtMXN(totalADR) },
      { label: 'Propiedades activas',  value: propiedades.length + ' casas' },
    ];
    const boxW2 = (doc.page.width - 100 - 30) / 4;
    const boxY2 = doc.y;

    kpisC.forEach((kpi, i) => {
      const x = 50 + i * (boxW2 + 10);
      doc.rect(x, boxY2, boxW2, 55).lineWidth(1).strokeColor(INK20).stroke();
      doc.fill(INK60).fontSize(8).font('Helvetica')
         .text(kpi.label.toUpperCase(), x + 8, boxY2 + 8, { width: boxW2 - 16 });
      doc.fill(CORAL).fontSize(12).font('Helvetica-Bold')
         .text(kpi.value, x + 8, boxY2 + 24, { width: boxW2 - 16 });
    });

    doc.moveDown(4.5);

    doc.fill(INK).fontSize(11).font('Helvetica-Bold').text('Comparativa por propiedad');
    doc.moveDown(0.5);

    const cols2 = { prop: 50, ingreso: 200, noches: 340, adr: 410, ocu: 470 };
    const tY2   = doc.y;

    doc.rect(50, tY2, doc.page.width - 100, 22).fill(INK);
    doc.fill('white').fontSize(8).font('Helvetica-Bold')
       .text('PROPIEDAD', cols2.prop,    tY2 + 7)
       .text('INGRESOS',  cols2.ingreso,  tY2 + 7)
       .text('NOCHES',    cols2.noches,   tY2 + 7)
       .text('ADR',       cols2.adr,      tY2 + 7)
       .text('OCUP.',     cols2.ocu,      tY2 + 7);

    let rY2 = tY2 + 22;

    consolidado.propiedades.forEach((p, i) => {
      const bg = i % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
      doc.rect(50, rY2, doc.page.width - 100, 22).fill(bg);
      doc.fill(INK).fontSize(9).font('Helvetica')
         .text(p.name,                cols2.prop,    rY2 + 6, { width: 140 })
         .text(fmtMXN(p.ingresoTotal), cols2.ingreso, rY2 + 6)
         .text(p.noches + ' n.',      cols2.noches,   rY2 + 6)
         .text(fmtMXN(p.adr),         cols2.adr,      rY2 + 6)
         .text(p.ocupacion + '%',     cols2.ocu,      rY2 + 6);
      rY2 += 22;
    });

    doc.rect(50, rY2, doc.page.width - 100, 22).fill(BLUE);
    doc.fill('white').fontSize(9).font('Helvetica-Bold')
       .text('TOTAL',                       cols2.prop,    rY2 + 6)
       .text(fmtMXN(consolidado.ingresoTotal), cols2.ingreso, rY2 + 6)
       .text(consolidado.nochesTotal + ' n.', cols2.noches,  rY2 + 6);

    const footerY = doc.page.height - 40;
    doc.rect(0, footerY - 10, doc.page.width, 50).fill(INK);
    doc.fill(INK60).fontSize(8).font('Helvetica')
       .text(
         `Generado el ${new Date().toLocaleDateString('es-MX', {
           day: 'numeric', month: 'long', year: 'numeric',
         })} — Airbnb Finance Assistant`,
         50, footerY, { width: doc.page.width - 100, align: 'center' }
       );

    doc.end();

  } catch (err) {
    console.error('[executive-pdf] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

module.exports = { saveReport, listReports, getReport, generateAnnualReport, deleteReport, updatePrevYearRef, getAnalysisFromSaved, getAnalysisPDFFromSaved, getDashboard, getExecutivePDF };
