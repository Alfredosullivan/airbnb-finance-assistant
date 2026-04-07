// validator.js — Validación de archivos PDF
// Verifica que el archivo recibido sea un PDF válido y no exceda el tamaño máximo

const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES } = require('../../config');

/**
 * validatePDF — Valida tipo MIME y tamaño del archivo subido por multer
 * @param {Express.Multer.File} file - Objeto de archivo de multer
 * @returns {string|null} Mensaje de error si la validación falla, null si es válido
 */
function validatePDF(file) {
  if (!file) {
    return 'No se proporcionó ningún archivo';
  }

  // Verificar que el tipo MIME sea PDF
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return `Tipo de archivo no permitido: ${file.mimetype}. Solo se aceptan PDFs`;
  }

  // Verificar que el archivo no exceda el tamaño máximo configurado
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const maxMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
    const fileMB = (file.size / (1024 * 1024)).toFixed(2);
    return `El archivo (${fileMB} MB) excede el tamaño máximo permitido de ${maxMB} MB`;
  }

  return null; // Sin errores
}

module.exports = { validatePDF };
