'use strict';

// logger.js — Logger dedicado para el módulo scheduler.
//
// ¿Por qué un logger propio y no usar console.log directo en cada job?
// Centralizar el formato aquí significa que si mañana migramos a Winston o Pino,
// solo tocamos este archivo — no tenemos que buscar 20 console.log dispersos.
// Es el principio Open/Closed: abierto para cambiar la implementación,
// cerrado para modificar los consumidores.

/**
 * Imprime un mensaje con prefijo [SCHEDULER] y timestamp ISO.
 * Separar info de error permite redirigir cada stream a diferentes destinos
 * en producción (stdout → logs normales, stderr → alertas).
 *
 * @param {'info'|'warn'|'error'} level - Nivel de log
 * @param {string}               msg   - Mensaje a imprimir
 */
function log(level, msg) {
  // Timestamp en formato ISO para facilitar búsquedas en herramientas de logs
  const ts = new Date().toISOString();
  const line = `[SCHEDULER][${level.toUpperCase()}] ${ts} — ${msg}`;

  if (level === 'error') {
    // Los errores van a stderr para que los sistemas de monitoreo los detecten
    console.error(line);
  } else {
    console.log(line);
  }
}

// CommonJS: exportamos la función directamente.
// Tu código original usaba "export default log" (ES Module syntax)
// que causaría SyntaxError porque este proyecto no tiene "type":"module"
// en package.json.
module.exports = log;
