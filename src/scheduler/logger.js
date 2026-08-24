'use strict';

const logger = require('../config/logger');

// Wrapper para el módulo scheduler que antepone el prefijo [SCHEDULER].
// La interfaz externa (log('info', msg)) no cambia — los consumers no se tocan.
function log(level, msg) {
  logger[level](`[SCHEDULER] ${msg}`);
}

module.exports = log;
