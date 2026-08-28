// SessionStore.js — Almacén de sesiones de procesamiento temporal por usuario
// Reemplaza el singleton global de upload.controller.js.
// Cada sesión está identificada por "userId:sessionId" — un usuario nunca puede
// acceder a la sesión de otro aunque conozca el sessionId, porque el userId
// viene del token JWT verificado por requireAuth.

'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs');
const logger = require('../config/logger');

const TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

// Map<"userId:sessionId", ProcessingSession>
const _sessions = new Map();

function _key(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

function _unlinkFiles(session) {
  const paths = [session.airbnbPath, ...session.bankPaths].filter(Boolean);
  paths.forEach((p) => {
    try {
      fs.unlinkSync(p);
    } catch (_) {}
  });
}

/**
 * create — Inicia una nueva sesión de procesamiento para el usuario.
 * @param {number} userId
 * @returns {string} sessionId UUID generado por el servidor
 */
function create(userId) {
  const sessionId = randomUUID();
  const now = Date.now();
  _sessions.set(_key(userId, sessionId), {
    airbnbPath: null,
    airbnbFileType: null,
    bankPaths: [],
    reportData: null,
    airbnbData: null,
    compareResult: null,
    createdAt: now,
    expiresAt: now + TTL_MS,
  });
  logger.info(`[session] Sesión ${sessionId} creada (user=${userId})`);
  return sessionId;
}

/**
 * get — Devuelve la sesión activa o null si no existe o expiró.
 * Cuando expira la limpia automáticamente (archivos + Map entry).
 * @param {number} userId
 * @param {string|null} sessionId
 * @returns {Object|null}
 */
function get(userId, sessionId) {
  if (!sessionId) return null;
  const key = _key(userId, sessionId);
  const session = _sessions.get(key);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    _unlinkFiles(session);
    _sessions.delete(key);
    logger.info(`[session] Sesión ${sessionId} expirada al acceder (user=${userId})`);
    return null;
  }
  return session;
}

/**
 * destroy — Elimina la sesión y sus archivos temporales del disco.
 * @param {number} userId
 * @param {string|null} sessionId
 */
function destroy(userId, sessionId) {
  if (!sessionId) return;
  const key = _key(userId, sessionId);
  const session = _sessions.get(key);
  if (!session) return;
  _unlinkFiles(session);
  _sessions.delete(key);
  logger.info(`[session] Sesión ${sessionId} destruida (user=${userId})`);
}

/**
 * _forceExpire — Solo para tests: marca la sesión como expirada sin borrarla del Map.
 * Permite probar que get() devuelve null para sesiones expiradas.
 */
function _forceExpire(userId, sessionId) {
  const session = _sessions.get(_key(userId, sessionId));
  if (session) session.expiresAt = Date.now() - 1000;
}

function _cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, session] of _sessions) {
    if (now > session.expiresAt) {
      _unlinkFiles(session);
      _sessions.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) logger.info(`[session] TTL cleanup: ${cleaned} sesión(es) eliminada(s)`);
}

module.exports = { create, get, destroy, _forceExpire };

// Iniciar limpieza periódica solo fuera del entorno de tests para no interferir con Jest
if (process.env.NODE_ENV !== 'test') {
  setInterval(_cleanupExpired, 30 * 60 * 1000).unref();
}
