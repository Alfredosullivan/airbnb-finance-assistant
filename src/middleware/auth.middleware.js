// auth.middleware.js — Middleware de autenticación JWT
// Protege rutas privadas verificando la cookie 'token'

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_local';

/**
 * requireAuth — Verifica que el usuario esté autenticado
 * Lee el JWT de la cookie httpOnly 'token', lo valida y añade req.user al request.
 * Si no hay token o es inválido, responde 401.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Adjuntar datos del usuario al request para uso en controllers
    req.user = { userId: decoded.userId, username: decoded.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = { requireAuth };
