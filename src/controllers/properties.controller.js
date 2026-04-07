// properties.controller.js — Gestión de propiedades Airbnb del usuario
// Cada usuario puede tener múltiples propiedades; cada reporte pertenece a una.

'use strict';

const PropRepo             = require('../repositories/PropertyRepository');
const ReportRepo           = require('../repositories/ReportRepository');
const annualExcelGenerator = require('../services/annualExcelGenerator');

// ── Controllers ────────────────────────────────────────────────

/**
 * listProperties — Lista todas las propiedades del usuario
 * GET /api/properties
 */
async function listProperties(req, res) {
  try {
    const props = await PropRepo.findAllByUser(req.user.userId);
    return res.json({ properties: props });
  } catch (err) {
    console.error('[properties] Error en listProperties:', err.message);
    return res.status(500).json({ error: 'Error al listar propiedades' });
  }
}

/**
 * createProperty — Crea una nueva propiedad para el usuario
 * POST /api/properties  { name }
 */
async function createProperty(req, res) {
  try {
    const userId = req.user.userId;
    const { name } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'El nombre de la propiedad es requerido' });
    }
    const cleanName = String(name).trim();

    const id = await PropRepo.create(userId, cleanName);
    console.log(`[properties] Nueva propiedad: "${cleanName}" (id=${id}, user=${userId})`);

    return res.status(201).json({
      success:  true,
      property: { id, name: cleanName },
    });
  } catch (err) {
    console.error('[properties] Error en createProperty:', err.message);
    return res.status(500).json({ error: 'Error al crear la propiedad' });
  }
}

/**
 * renameProperty — Cambia el nombre de una propiedad del usuario
 * PUT /api/properties/:id  { name }
 */
async function renameProperty(req, res) {
  try {
    const userId = req.user.userId;
    const id     = parseInt(req.params.id, 10);
    const { name } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'El nombre de la propiedad es requerido' });
    }
    const cleanName = String(name).trim();

    const prop = await PropRepo.findByIdAndUser(id, userId);
    if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });

    await PropRepo.rename(id, cleanName);
    console.log(`[properties] Propiedad ${id} renombrada a "${cleanName}"`);

    return res.json({ success: true, name: cleanName });
  } catch (err) {
    console.error('[properties] Error en renameProperty:', err.message);
    return res.status(500).json({ error: 'Error al renombrar la propiedad' });
  }
}

/**
 * deleteProperty — Elimina una propiedad y todos sus reportes
 * No permite eliminar la última propiedad del usuario.
 * DELETE /api/properties/:id
 */
async function deleteProperty(req, res) {
  try {
    const userId = req.user.userId;
    const id     = parseInt(req.params.id, 10);

    const prop = await PropRepo.findByIdAndUser(id, userId);
    if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });

    // No permitir eliminar la única propiedad
    if (await PropRepo.countByUser(userId) <= 1) {
      return res.status(400).json({ error: 'No puedes eliminar la única propiedad' });
    }

    // No permitir eliminar si tiene reportes guardados
    const reportes = await ReportRepo.countByProperty(id);
    if (reportes > 0) {
      return res.status(400).json({
        error: `No se puede eliminar "${prop.name}": tiene ${reportes} reporte${reportes !== 1 ? 's' : ''} guardado${reportes !== 1 ? 's' : ''}. Elimina primero todos sus reportes.`,
      });
    }

    await PropRepo.remove(id);
    console.log(`[properties] Propiedad ${id} eliminada (user=${userId})`);

    return res.json({ success: true });
  } catch (err) {
    console.error('[properties] Error en deleteProperty:', err.message);
    return res.status(500).json({ error: 'Error al eliminar la propiedad' });
  }
}

/**
 * getCombinedReport — Genera un Excel anual combinando todas las propiedades
 * GET /api/properties/combined/:year
 */
async function getCombinedReport(req, res) {
  try {
    const userId = req.user.userId;
    const year   = parseInt(req.params.year, 10);
    if (!year || year < 2020 || year > 2030) {
      return res.status(400).json({ error: 'Año inválido. Debe estar entre 2020 y 2030.' });
    }

    const rows = await ReportRepo.findByYearWithPropertyName(userId, year);

    if (rows.length === 0) {
      return res.status(404).json({ error: `No hay reportes guardados para ${year}` });
    }

    const byMonth = {};
    for (const r of rows) {
      let s = {};
      try { s = JSON.parse(r.summary); } catch (_) {}

      const sum        = s?.summary   || {};
      const excelData  = s?.excelData || {};
      const airbnbTotal = parseFloat(
        sum.totalAirbnbPayouts || sum.totals?.airbnbPayouts || sum.airbnbTotal || 0
      );
      const ivaRet = excelData.ivaRetenido != null
        ? excelData.ivaRetenido
        : parseFloat((airbnbTotal * 0.08).toFixed(2));
      const isrRet = excelData.isrRetenido != null
        ? excelData.isrRetenido
        : parseFloat((airbnbTotal * 0.04).toFixed(2));
      const comision = excelData.comisionAirbnb ||
        parseFloat((airbnbTotal * 0.035).toFixed(2));

      if (!byMonth[r.month]) {
        byMonth[r.month] = {
          month:          r.month,
          label:          r.label,
          airbnbTotal:    0,
          bankTotal:      0,
          noches:         0,
          comisionAirbnb: 0,
          ivaRetenido:    0,
          isrRetenido:    0,
          grossIncome:    0,
          matchRate:      '—',
          payoutsCount:   0,
          hasExcelData:   false,
          propiedades:    [],
        };
      }

      byMonth[r.month].airbnbTotal    += airbnbTotal;
      byMonth[r.month].bankTotal      += parseFloat(
        sum.totalBankDeposits || sum.totals?.bankDepositsMonth || 0
      );
      byMonth[r.month].noches         += excelData.noches || 0;
      byMonth[r.month].comisionAirbnb += comision;
      byMonth[r.month].ivaRetenido    += ivaRet;
      byMonth[r.month].isrRetenido    += isrRet;
      if (excelData.noches > 0) byMonth[r.month].hasExcelData = true;
      byMonth[r.month].propiedades.push(r.property_name || '?');
    }

    const monthlyData = Object.values(byMonth);

    const prevRows = await ReportRepo.findSummaryByYearAll(userId, year - 1);

    const prevData = {};
    prevRows.forEach(r => {
      let s = {};
      try { s = JSON.parse(r.summary); } catch (_) {}
      const mm = r.month.split('-')[1];
      if (!prevData[mm]) prevData[mm] = { airbnbTotal: 0, noches: 0 };
      prevData[mm].airbnbTotal +=
        parseFloat(s?.summary?.totalAirbnbPayouts || s?.summary?.totals?.airbnbPayouts || 0);
      prevData[mm].noches      += s?.excelData?.noches || 0;
    });

    const mesesGuardados  = rows.map(r => r.month.split('-')[1]);
    const mesesFaltantes  = ['01','02','03','04','05','06','07','08','09','10','11','12']
      .filter(m => !mesesGuardados.includes(m));

    const propNames = await PropRepo.findNamesByUser(userId);

    console.log(
      `[properties] Reporte combinado ${year}: ${monthlyData.length} meses,` +
      ` ${propNames.length} propiedades`
    );

    const buffer = await annualExcelGenerator.generateAnnualReport({
      year,
      monthlyData,
      prevData,
      prevYear:       year - 1,
      mesesFaltantes,
      tituloExtra:    `Combinado — ${propNames.join(', ')}`,
    });

    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="Reporte_Anual_${year}_Combinado.xlsx"`);
    res.send(buffer);

  } catch (err) {
    console.error('[properties] Error en getCombinedReport:', err.message);
    res.status(500).json({ error: `Error al generar el reporte combinado: ${err.message}` });
  }
}

module.exports = {
  listProperties,
  createProperty,
  renameProperty,
  deleteProperty,
  getCombinedReport,
};
