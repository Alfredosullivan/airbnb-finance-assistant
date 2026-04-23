'use strict';

// src/queue/index.js — Punto de entrada del módulo queue.
//
// Misma filosofía de inicialización explícita que el scheduler:
// los workers NO arrancan al hacer require('./src/queue'), sino solo
// cuando se llama initQueue(). Así los tests pueden importar la cola
// sin activar timers reales ni conexiones a Claude API.
//
// Flujo de arranque:
//   index.js (raíz) → initSchema() → initScheduler() + initQueue()

const { startWorker } = require('./workers/analysisWorker');

/**
 * Inicia todos los workers de la cola.
 * Debe llamarse UNA VEZ, después de que el servidor esté aceptando conexiones.
 */
function initQueue() {
  startWorker();
}

module.exports = { initQueue };
