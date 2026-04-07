// upload.controller.js — Controlador de uploads de PDFs y CSVs
// Recibe los archivos subidos por multer, los valida y guarda sus rutas en memoria

const fs   = require('fs');
const path = require('path');
const { validatePDF }  = require('../utils/validator');

/** Elimina un archivo del disco sin lanzar excepción si no existe */
function tryUnlink(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// Almacén en memoria de las rutas de los PDFs y el último reporte generado.
// En una versión con múltiples usuarios se reemplazaría por sesiones o una BD.
const store = {
  airbnbPath:     null,
  airbnbFileType: null,  // 'csv' | 'pdf' — detectado por extensión al subir
  bankPaths:      [],    // Acepta 1 o 2 PDFs bancarios
  reportData:     null,  // Último reporte generado; se limpia con resetReport()
};

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
 * uploadAirbnb — Procesa el PDF o CSV del reporte de Airbnb
 * multer ya guardó el archivo en disco; aquí detectamos el tipo y registramos la ruta
 */
async function uploadAirbnb(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const fileType = detectFileType(req.file.originalname);

    // Validar PDF si corresponde (CSV no tiene validación de mimetype estricta)
    if (fileType === 'pdf') {
      const validationError = validatePDF(req.file);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
    } else if (fileType === 'unknown') {
      return res.status(400).json({ error: 'Formato no soportado. Usa PDF o CSV.' });
    }

    // Eliminar archivo anterior de Airbnb si existe
    tryUnlink(store.airbnbPath);

    store.airbnbPath     = req.file.path;
    store.airbnbFileType = fileType;

    res.json({
      message:  `Reporte Airbnb recibido correctamente (${fileType.toUpperCase()})`,
      filename: req.file.originalname,
      fileType,
    });
  } catch (err) {
    res.status(500).json({ error: `Error al procesar el archivo de Airbnb: ${err.message}` });
  }
}

/**
 * uploadBank — Procesa uno o dos PDFs del estado de cuenta bancario
 * Recibe un slot (1 o 2) para saber en qué posición del arreglo guardar la ruta.
 * req.files contiene el array de archivos subidos por multer (.array)
 */
async function uploadBank(req, res) {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    // Validar todos los archivos recibidos
    for (const file of files) {
      const validationError = validatePDF(file);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
    }

    // slot indica qué posición del arreglo ocupa este archivo (1-based desde el cliente)
    const slot  = parseInt(req.body.slot, 10) || 1;
    const index = slot - 1; // Convertir a 0-based

    // Eliminar archivo bancario anterior del mismo slot si existe
    tryUnlink(store.bankPaths[index]);

    store.bankPaths[index] = files[0].path;

    res.json({
      success:       true,
      filesReceived: files.length,
      slot,
      filename:      files[0].originalname,
    });
  } catch (err) {
    res.status(500).json({ error: `Error al procesar el archivo bancario: ${err.message}` });
  }
}

/**
 * resetReport — Limpia el reporte en memoria y elimina los archivos subidos del disco.
 * Tras el reset el usuario debe subir nuevos archivos para generar un reporte.
 */
async function resetReport(req, res) {
  try {
    // Eliminar archivos físicos del disco
    const pathsToDelete = [store.airbnbPath, ...store.bankPaths].filter(Boolean);
    pathsToDelete.forEach(tryUnlink);
    console.log(`[uploads] ${pathsToDelete.length} archivo(s) eliminados al hacer reset`);

    // Limpiar todo el store
    store.reportData    = null;
    store.airbnbData    = null;
    store.compareResult = null;
    store.airbnbPath    = null;
    store.airbnbFileType = null;
    store.bankPaths     = [];

    res.json({ success: true, message: 'Resultados limpiados' });
  } catch (err) {
    res.status(500).json({ error: `Error al limpiar el reporte: ${err.message}` });
  }
}

// Exportar también el store para que el report controller pueda leer las rutas
module.exports = { uploadAirbnb, uploadBank, resetReport, store };
