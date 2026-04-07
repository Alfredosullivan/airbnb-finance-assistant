// reports.routes.js — Rutas para el historial de reportes guardados
// Todas requieren autenticación JWT (middleware requireAuth)
// Montadas bajo el prefijo /api/reports en index.js

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Save and retrieve monthly reconciliation reports
 */

/**
 * @swagger
 * /api/reports/save:
 *   post:
 *     summary: Save (or overwrite) the reconciliation report for a month
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, month, label, summary]
 *             properties:
 *               propertyId:
 *                 type: integer
 *                 example: 1
 *               month:
 *                 type: string
 *                 example: "2026-02"
 *                 description: Month key in YYYY-MM format
 *               label:
 *                 type: string
 *                 example: "Febrero 2026"
 *               summary:
 *                 type: object
 *                 description: Full JSON report produced by formatReport()
 *     responses:
 *       200:
 *         description: Report saved or overwritten
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/reports/list:
 *   get:
 *     summary: List all saved reports for the authenticated user (metadata only)
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: propertyId
 *         schema:
 *           type: integer
 *         description: Filter by property ID (optional)
 *     responses:
 *       200:
 *         description: Array of report metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reports:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ReportMeta'
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/reports/{month}:
 *   get:
 *     summary: Retrieve the full JSON report for a specific month
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: month
 *         required: true
 *         schema:
 *           type: string
 *         example: "2026-02"
 *         description: Month in YYYY-MM format
 *       - in: query
 *         name: propertyId
 *         schema:
 *           type: integer
 *         description: Property ID (optional — defaults to user's first property)
 *     responses:
 *       200:
 *         description: Full report JSON
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Complete formatReport() output stored for this month
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Report not found for this month
 *   delete:
 *     summary: Delete the saved report for a specific month
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: month
 *         required: true
 *         schema:
 *           type: string
 *         example: "2026-02"
 *         description: Month in YYYY-MM format
 *       - in: query
 *         name: propertyId
 *         schema:
 *           type: integer
 *         description: Property ID (optional)
 *     responses:
 *       200:
 *         description: Report deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Report not found
 */

const express                              = require('express');
const router                               = express.Router();
const { requireAuth }                      = require('../middleware/auth.middleware');
const { saveReport, listReports, getReport, generateAnnualReport, deleteReport, updatePrevYearRef, getAnalysisFromSaved, getAnalysisPDFFromSaved, getDashboard, getExecutivePDF } = require('../controllers/reports.controller');

// POST   /api/reports/save                → Guarda o sobreescribe el reporte del mes actual
router.post('/save',                requireAuth, saveReport);

// POST   /api/reports/update-prev-year-ref → Inyecta prevYearData en un reporte del año siguiente
// IMPORTANTE: debe estar antes de /:month para evitar conflicto de ruta
router.post('/update-prev-year-ref', requireAuth, updatePrevYearRef);

// GET    /api/reports/list          → Lista todos los reportes del usuario (solo metadatos + totales)
router.get('/list',           requireAuth, listReports);

// GET    /api/reports/annual/:year    → Descarga el reporte anual en Excel
// GET    /api/reports/dashboard/:year → Métricas del dashboard anual
// IMPORTANTE: deben estar antes de /:month
router.get('/annual/:year',        requireAuth, generateAnnualReport);
router.get('/dashboard/:year',     requireAuth, getDashboard);
router.get('/executive-pdf/:year', requireAuth, getExecutivePDF);

// POST   /api/reports/:month/analysis     → Análisis IA de un reporte guardado (ej: /api/reports/2026-02/analysis)
// POST   /api/reports/:month/analysis/pdf → Descarga el análisis como PDF
// IMPORTANTE: deben estar antes de GET /:month para que no haya conflicto de ruta
router.post('/:month/analysis',     requireAuth, getAnalysisFromSaved);
router.post('/:month/analysis/pdf', requireAuth, getAnalysisPDFFromSaved);

// GET    /api/reports/:month        → Devuelve el JSON completo de un mes (ej: /api/reports/2026-02)
router.get('/:month',         requireAuth, getReport);

// DELETE /api/reports/:month        → Elimina el reporte de un mes (?propertyId=N)
router.delete('/:month',      requireAuth, deleteReport);

module.exports = router;
