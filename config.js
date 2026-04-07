// config.js — Constantes globales de la aplicación
// Centraliza toda la configuración para facilitar cambios sin tocar el resto del código

const path = require('path');

module.exports = {
  // Puerto en el que escucha el servidor Express
  PORT: process.env.PORT || 3000,

  // Ruta absoluta a la carpeta donde se guardan los PDFs subidos temporalmente
  UPLOADS_DIR: path.join(__dirname, 'uploads'),

  // Tamaño máximo permitido por archivo (en bytes)
  MAX_FILE_SIZE_MB: Number(process.env.MAX_FILE_SIZE_MB) || 10,
  get MAX_FILE_SIZE_BYTES() {
    return this.MAX_FILE_SIZE_MB * 1024 * 1024;
  },

  // Tipos MIME aceptados para la validación de archivos
  ALLOWED_MIME_TYPES: ['application/pdf'],
};
