// upload.controller.js — Controlador de uploads de PDFs y CSVs
// Recibe los archivos subidos por multer, los valida y los registra en la sesión del usuario.
// Cada usuario tiene su propia sesión identificada por userId:sessionId.

'use strict';

const logger = require('../config/logger');
const fs = require('fs');
const path = require('path');
const { validatePDF } = require('../utils/validator');
const SessionStore = require('../store/SessionStore');

/** Elimina un archivo del disco sin lanzar excepción si no existe */
function tryUnlink(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (_) {}
}

/**
 * detectFileType — Determina el tipo de archivo por su extensión
 * @param {string} originalname - Nombre original del archivo
 * @returns {'csv'|'pdf'|'unknown'}
 */
function detectFileType(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.pdf') return 'pdf';
  return 'unknown';
}

/**
 * uploadAirbnb — Procesa el PDF o CSV del reporte de Airbnb.
 * Si el request trae X-Session-Id y la sesión existe, la reutiliza (re-upload).
 * Si no, crea una sesión nueva y devuelve el sessionId al cliente.
 * El sessionId es el punto de entrada de toda la sesión de procesamiento.
 */
async function uploadAirbnb(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const fileType = detectFileType(req.file.originalname);

    if (fileType === 'pdf') {
      const validationError = validatePDF(req.file);
      if (validationError) {
        tryUnlink(req.file.path);
        return res.status(400).json({ error: validationError });
      }
    } else if (fileType === 'unknown') {
      tryUnlink(req.file.path);
      return res.status(400).json({ error: 'Formato no soportado. Usa PDF o CSV.' });
    }

    const userId = req.user.userId;

    // Intentar reutilizar sesión existente; si no existe o expiró, crear una nueva
    let sessionId = req.headers['x-session-id'];
    let session = SessionStore.get(userId, sessionId);

    if (!session) {
      sessionId = SessionStore.create(userId);
      session = SessionStore.get(userId, sessionId);
    }

    // Reemplazar archivo Airbnb anterior si existía
    tryUnlink(session.airbnbPath);
    session.airbnbPath = req.file.path;
    session.airbnbFileType = fileType;
    // Invalidar resultados de procesamiento previo al cambiar el archivo fuente
    session.reportData = null;
    session.airbnbData = null;
    session.compareResult = null;

    logger.info(`[upload] Airbnb (user=${userId}, session=${sessionId}, tipo=${fileType})`);

    return res.json({
      message: `Reporte Airbnb recibido correctamente (${fileType.toUpperCase()})`,
      filename: req.file.originalname,
      fileType,
      sessionId,
    });
  } catch (err) {
    if (req.file) tryUnlink(req.file.path);
    return res
      .status(500)
      .json({ error: `Error al procesar el archivo de Airbnb: ${err.message}` });
  }
}

/**
 * uploadBank — Procesa uno o dos PDFs del estado de cuenta bancario.
 * Requiere que la sesión ya exista (creada por uploadAirbnb).
 * El slot (1 o 2) indica qué posición del arreglo ocupa este PDF.
 */
async function uploadBank(req, res) {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    for (const file of files) {
      const validationError = validatePDF(file);
      if (validationError) {
        files.forEach((f) => tryUnlink(f.path));
        return res.status(400).json({ error: validationError });
      }
    }

    const userId = req.user.userId;
    const sessionId = req.headers['x-session-id'];
    const session = SessionStore.get(userId, sessionId);

    if (!session) {
      // Limpiar archivos que multer ya guardó en disco
      files.forEach((f) => tryUnlink(f.path));
      return res.status(400).json({
        error:
          'Sesión no encontrada o expirada. Sube primero el reporte de Airbnb para iniciar una sesión.',
      });
    }

    const slot = parseInt(req.body.slot, 10) || 1;
    const index = slot - 1;

    // Reemplazar archivo bancario anterior del mismo slot si existe
    tryUnlink(session.bankPaths[index]);
    session.bankPaths[index] = files[0].path;
    // Invalidar resultados de procesamiento previo al cambiar el archivo fuente
    session.reportData = null;
    session.airbnbData = null;
    session.compareResult = null;

    logger.info(`[upload] Banco (user=${userId}, session=${sessionId}, slot=${slot})`);

    return res.json({
      success: true,
      filesReceived: files.length,
      slot,
      filename: files[0].originalname,
    });
  } catch (err) {
    if (req.files) req.files.forEach((f) => tryUnlink(f.path));
    return res.status(500).json({ error: `Error al procesar el archivo bancario: ${err.message}` });
  }
}

/**
 * resetReport — Destruye la sesión del usuario y elimina sus archivos temporales.
 * POST /api/reset
 */
async function resetReport(req, res) {
  try {
    const userId = req.user.userId;
    const sessionId = req.headers['x-session-id'];

    SessionStore.destroy(userId, sessionId);
    logger.info(`[upload] Reset completado (user=${userId}, session=${sessionId})`);

    return res.json({ success: true, message: 'Sesión limpiada' });
  } catch (err) {
    return res.status(500).json({ error: `Error al limpiar la sesión: ${err.message}` });
  }
}

module.exports = { uploadAirbnb, uploadBank, resetReport };
