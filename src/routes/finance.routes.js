// finance.routes.js — Definición de rutas de la API de finanzas
// Registra los endpoints de upload, reporte y reset; configura multer para almacenamiento temporal

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const { UPLOADS_DIR, MAX_FILE_SIZE_BYTES } = require('../../config');
const { uploadAirbnb, uploadBank, resetReport }                   = require('../controllers/upload.controller');
const { getReport, generateExcel, getMonthlyAnalysis, getMonthlyAnalysisPDF, queueExcelGeneration } = require('../controllers/report.controller');
const { requireAuth }                           = require('../middleware/auth.middleware');

const router = express.Router();

// ── Mimetypes aceptados según fuente ──────────────────────────
// Airbnb: PDF o CSV (el CSV de Airbnb puede venir con distintos mimetypes según el OS)
const AIRBNB_MIMETYPES = new Set([
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
]);

// Banco: solo PDF
const BANK_MIMETYPES = new Set(['application/pdf']);

// ── Configuración de multer ────────────────────────────────────
// diskStorage guarda el archivo en disco con un nombre único para evitar colisiones
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

// Multer para el endpoint de Airbnb (acepta PDF y CSV)
const uploadAirbnbMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AIRBNB_MIMETYPES.has(file.mimetype) || ext === '.csv' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF o CSV para el reporte de Airbnb'), false);
    }
  },
});

// Multer para el endpoint bancario (solo PDF)
const uploadBankMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (BANK_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF para el estado de cuenta bancario'), false);
    }
  },
});

// ── Endpoints ──────────────────────────────────────────────────

// POST /api/upload/airbnb — Recibe el PDF o CSV del reporte de Airbnb (campo: "pdf")
router.post('/upload/airbnb', uploadAirbnbMiddleware.single('pdf'), uploadAirbnb);

// POST /api/upload/bank — Recibe 1 o 2 PDFs del estado de cuenta bancario
// Campo esperado: "bankPdf" (maxCount: 2); el body puede incluir "slot" (1 o 2)
router.post('/upload/bank', uploadBankMiddleware.array('bankPdf', 2), uploadBank);

// GET /api/report — Genera y devuelve el reporte comparativo
router.get('/report', getReport);

// GET /api/report/excel — Descarga el reporte mensual en formato .xlsx (requiere auth)
router.get('/report/excel', requireAuth, generateExcel);

// POST /api/reset — Limpia el reporte en memoria (no elimina los PDFs subidos)
router.post('/reset', resetReport);

// POST /api/analysis/monthly     — Genera análisis IA del reporte actual (requiere auth)
router.post('/analysis/monthly',     requireAuth, getMonthlyAnalysis);

// POST /api/analysis/monthly/pdf — Descarga el análisis como PDF (requiere auth)
router.post('/analysis/monthly/pdf', requireAuth, getMonthlyAnalysisPDF);

// POST /api/excel/queue — Encola la generación del Excel en background (requiere auth)
// Responde 202 inmediatamente con jobId; el cliente hace polling a GET /api/jobs/:jobId
router.post('/excel/queue',          requireAuth, queueExcelGeneration);

// Manejo de errores de multer (tamaño o tipo de archivo)
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = router;
