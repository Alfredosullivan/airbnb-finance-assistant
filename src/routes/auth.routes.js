// auth.routes.js — Rutas de autenticación de usuarios
// Montadas bajo el prefijo /api/auth en index.js

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: User registration, login, logout and session management
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user and start a session
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, email, password]
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 example: johndoe
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: secret123
 *     responses:
 *       201:
 *         description: User created. Sets an httpOnly JWT cookie (token).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error — username < 3 chars, invalid email, or password < 6 chars
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Username or email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john@example.com
 *               password:
 *                 type: string
 *                 example: secret123
 *     responses:
 *       200:
 *         description: Login successful. Sets an httpOnly JWT cookie (token).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Missing required field (email or password)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Incorrect credentials (generic — does not reveal whether email exists)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: End the current session
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Session cleared. The token cookie is invalidated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 needsPropertyName:
 *                   type: boolean
 *                   description: True when the user has no properties yet
 *       401:
 *         description: No active session
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

const express                         = require('express');
const router                          = express.Router();
const rateLimit                       = require('express-rate-limit');
const { register, login, logout, me } = require('../controllers/auth.controller');

// Límite de intentos en endpoints de autenticación (protección anti-fuerza-bruta)
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // ventana de 15 minutos
  max:             20,              // máximo 20 intentos por IP en la ventana
  standardHeaders: true,           // incluye RateLimit-* headers en la respuesta
  legacyHeaders:   false,
  message:         { error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.' },
});

// POST /api/auth/register  → Crea un nuevo usuario y abre sesión
router.post('/register', authLimiter, register);

// POST /api/auth/login     → Inicia sesión y devuelve cookie JWT
router.post('/login', authLimiter, login);

// POST /api/auth/logout    → Cierra sesión limpiando la cookie
router.post('/logout', logout);

// GET  /api/auth/me        → Devuelve el usuario actual (si hay sesión activa)
router.get('/me', me);

module.exports = router;
