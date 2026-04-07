// errorHandler.js — Middleware centralizado de manejo de errores
// Captura todos los errores propagados via next(err) desde controladores y rutas.
// DEBE registrarse como último middleware en index.js (después de todas las rutas).

/**
 * errorHandler — Middleware de 4 argumentos que Express reconoce como error handler.
 * Devuelve una respuesta JSON estructurada y nunca expone el stack en producción.
 *
 * @param {Error}                          err
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next  // requerido aunque no se use (firma de 4 args)
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status  = err.statusCode || err.status || 500;
  const message = err.message    || 'Error interno del servidor';
  const code    = err.code       || 'INTERNAL_ERROR';

  // Solo incluir el stack trace en modo desarrollo
  const body = {
    status:  'error',
    message,
    code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  };

  // Log interno (reemplazable por Winston/Pino en fases futuras)
  if (status >= 500) {
    console.error(`[errorHandler] ${status} — ${message}`, err.stack || '');
  }

  res.status(status).json(body);
}

module.exports = { errorHandler };
