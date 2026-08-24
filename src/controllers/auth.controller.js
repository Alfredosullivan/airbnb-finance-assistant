// auth.controller.js — Controlador de autenticación de usuarios
// Maneja registro, login, logout y verificación de sesión activa

const logger = require('../config/logger');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserRepo = require('../repositories/UserRepository');
const PropRepo = require('../repositories/PropertyRepository');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_local';

const COOKIE_OPTS = {
  httpOnly: true, // No accesible desde JS del cliente (protección XSS)
  secure: false, // false en desarrollo (sin HTTPS)
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días en milisegundos
};

// ── Helpers internos ────────────────────────────────────────────

function generarToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });
}

// ── Controllers públicos ────────────────────────────────────────

/**
 * register — Crea un nuevo usuario
 * Body esperado: { username, email, password } — ya validado y transformado por RegisterSchema
 */
async function register(req, res) {
  try {
    const { username, email, password } = req.body;

    const existente = await UserRepo.findByUsernameOrEmail(username, email);
    if (existente) {
      return res.status(409).json({ error: 'El nombre de usuario o email ya está registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = await UserRepo.create(username, email, passwordHash);

    const token = generarToken(userId, username);
    res.cookie('token', token, COOKIE_OPTS);

    logger.info(`[auth] Nuevo usuario registrado: ${username} (id=${userId})`);

    return res.status(201).json({
      success: true,
      user: { id: userId, username, email },
    });
  } catch (err) {
    logger.error('[auth] Error en register:', err.message);
    return res.status(500).json({ error: 'Error interno al registrar usuario' });
  }
}

/**
 * login — Inicia sesión con email y contraseña
 * Body esperado: { email, password } — ya validado y transformado por LoginSchema
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // Buscar usuario por email (ya lowercased y trimmed por LoginSchema)
    const user = await UserRepo.findByEmail(email);

    if (!user) {
      // Respuesta genérica para no revelar si el email existe
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Comparar contraseña con el hash guardado
    const coincide = await bcrypt.compare(password, user.password_hash);
    if (!coincide) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Generar JWT y setear cookie
    const token = generarToken(user.id, user.username);
    res.cookie('token', token, COOKIE_OPTS);

    logger.info(`[auth] Login exitoso: ${user.username}`);

    return res.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (err) {
    logger.error('[auth] Error en login:', err.message);
    return res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
}

/**
 * logout — Cierra la sesión limpiando la cookie del token
 */
function logout(req, res) {
  res.clearCookie('token');
  return res.json({ success: true, message: 'Sesión cerrada' });
}

/**
 * me — Devuelve el usuario actual si hay sesión activa
 * Lee y verifica el JWT de la cookie para obtener los datos del usuario
 */
async function me(req, res) {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    // Verificar JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // Buscar usuario en DB para confirmar que aún existe
    const user = await UserRepo.findById(decoded.userId);

    if (!user) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    // needsPropertyName: true si el usuario solo tiene propiedades con el nombre
    // por defecto 'Mi propiedad' (creado por la migración automática).
    const propCount = await PropRepo.countByUser(user.id);
    const defaultCount = await PropRepo.countDefaultByUser(user.id);

    // Sugerir renombrar si tiene exactamente 1 propiedad con nombre por defecto
    const needsPropertyName = propCount === 1 && defaultCount === 1;

    return res.json({ user, needsPropertyName });
  } catch (err) {
    logger.error('[auth] Error en me:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}

/**
 * getToken — Devuelve el JWT en el body para uso programático (CLI, scripts)
 * GET /api/auth/me/token — requiere autenticación (cookie o Bearer)
 *
 * ¿Por qué existe este endpoint?
 * El browser puede recibir el JWT como cookie httpOnly (seguro contra XSS).
 * Pero un CLI de Node.js no tiene jar de cookies — no puede enviar la cookie
 * en requests posteriores. Este endpoint permite al usuario autenticado en el
 * browser obtener el token como texto plano para configurar el CLI.
 *
 * Flujo esperado:
 *   1. Usuario inicia sesión en el browser → cookie seteada
 *   2. Usuario visita GET /api/auth/me/token → recibe { token: "eyJ..." }
 *   3. Usuario corre: airbnb-cli set-token eyJ...
 *   4. El CLI incluye ese token como Authorization: Bearer en requests futuros
 *
 * ¿Por qué re-firmar en lugar de devolver la cookie directamente?
 * La cookie es httpOnly — el servidor no puede leer su valor desde la respuesta
 * anterior y devolverlo. Solo puede generar un JWT nuevo con el mismo payload.
 * Generamos con expiración de 7 días, igual que la cookie de sesión.
 */
function getToken(req, res) {
  // req.user ya fue poblado por requireAuth — contiene userId y username
  const token = jwt.sign({ userId: req.user.userId, username: req.user.username }, JWT_SECRET, {
    expiresIn: '7d',
  });
  return res.json({ token });
}

module.exports = { register, login, logout, me, getToken };
