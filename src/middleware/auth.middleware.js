// auth.middleware.js — Middleware de autenticación JWT
// Protege rutas privadas aceptando autenticación por cookie httpOnly O por Bearer token.
// El orden de preferencia es: cookie primero (browser), Bearer como fallback (CLI / API).

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_local';

/**
 * requireAuth — Verifica que el usuario esté autenticado
 *
 * Fuentes de token aceptadas (en orden de preferencia):
 *   1. Cookie httpOnly 'token' — usada por el browser (más segura: no accesible desde JS)
 *   2. Header Authorization: Bearer <token> — usada por CLI y herramientas de API
 *
 * Si ninguna fuente proporciona un token, responde 401.
 * Si el token existe pero es inválido o expirado, responde 401.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
  // Intento 1: cookie httpOnly (comportamiento original del browser)
  let token = req.cookies && req.cookies.token;

  // Intento 2: header Authorization: Bearer <token> (para CLI y clientes programáticos)
  // ¿Por qué .slice(7)?  'Bearer ' tiene exactamente 7 caracteres — eliminamos el prefijo
  // para quedarnos solo con el JWT en sí.
  if (!token) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  // Si ninguna fuente entregó un token, el usuario no está autenticado
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Adjuntar datos del usuario al request para uso en controllers
    req.user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch {
    // jwt.verify lanza error si el token está expirado, malformado o firmado con otra clave
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { requireAuth };
