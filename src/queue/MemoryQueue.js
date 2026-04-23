'use strict';

// MemoryQueue.js — Motor de colas en memoria (FIFO).
//
// ¿Por qué una cola y no ejecutar Claude directo en el handler?
// Claude puede tardar 5–25 s. Si lo ejecutamos inline, el cliente espera
// con la conexión HTTP abierta. Si el cliente cierra la pestaña, la petición
// se cancela pero Claude sigue corriendo — desperdiciamos tokens de API y
// bloqueamos un slot de Express. Con una cola:
//   1. El endpoint responde en milisegundos (202 Accepted + jobId)
//   2. El worker procesa en background independientemente del cliente
//   3. El cliente hace polling ligero a GET /api/jobs/:id (< 1 KB por request)
//
// Interfaz diseñada para ser REEMPLAZABLE por Redis + BullMQ sin cambiar los workers:
// Si en producción necesitamos múltiples servidores o persistencia, solo cambiamos
// este archivo — los workers siguen llamando a addJob / getNextPending / updateJob
// exactamente igual. Eso es el principio Open/Closed aplicado a infraestructura.

const { v4: uuidv4 } = require('uuid');

class MemoryQueue {
  constructor() {
    // Map<string, job> — acceso O(1) por ID
    this.jobs = new Map();

    // Cola FIFO de IDs pendientes. Usamos un array con shift() — para volúmenes
    // bajos (< 1000 jobs/hora) el rendimiento es suficiente. Si escalara,
    // reemplazaríamos por una lista enlazada o directamente BullMQ.
    this.pending = [];
  }

  /**
   * Agrega un job a la cola y devuelve el objeto completo con su ID.
   *
   * @param {string} type - Tipo de job (ej: 'excel_generation')
   * @param {Object} data - Payload del job — debe ser serializable a JSON
   * @returns {Object}    - El job creado con status 'pending'
   */
  addJob(type, data) {
    const id  = `job_${uuidv4()}`;
    const job = {
      id,
      type,
      data,
      status:    'pending',   // pending → active → completed | failed
      result:    null,
      error:     null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.jobs.set(id, job);
    this.pending.push(id);
    return job;
  }

  /**
   * Devuelve el próximo job pendiente (FIFO) o null si no hay ninguno.
   * Descarta automáticamente IDs obsoletos (jobs cancelados o ya procesados
   * que por algún bug quedaron en pending).
   *
   * @returns {Object|null}
   */
  getNextPending() {
    while (this.pending.length > 0) {
      const id  = this.pending.shift();
      const job = this.jobs.get(id);

      // Solo retornamos el job si sigue en estado 'pending'.
      // Un job podría haberse marcado como 'failed' externamente
      // antes de que el worker lo tome — lo descartamos silenciosamente.
      if (job && job.status === 'pending') return job;
    }
    return null;
  }

  /**
   * Obtiene un job por ID (para polling del cliente).
   *
   * @param {string} id
   * @returns {Object|null}
   */
  getJob(id) {
    return this.jobs.get(id) || null;
  }

  /**
   * Actualiza campos del job y refresca `updatedAt`.
   * Usa spread para no mutar el objeto original directamente — más predecible.
   *
   * @param {string} id
   * @param {Object} updates - Campos a sobreescribir
   * @returns {Object|null}  - Job actualizado o null si no existe
   */
  updateJob(id, updates) {
    const job = this.jobs.get(id);
    if (!job) return null;

    const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
    this.jobs.set(id, updated);
    return updated;
  }

  /**
   * Elimina jobs completados o fallidos con más de 1 hora de antigüedad.
   * Se llama al final de cada ciclo del worker para evitar memory leaks.
   *
   * ¿Por qué 1 hora? Es suficiente para que el cliente haga polling y descargue
   * el resultado. En un sistema productivo, este TTL sería configurable por env var.
   */
  cleanup() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const [id, job] of this.jobs.entries()) {
      if (['completed', 'failed'].includes(job.status)) {
        if (new Date(job.createdAt).getTime() < oneHourAgo) {
          this.jobs.delete(id);
        }
      }
    }
  }
}

// Singleton: exportamos la instancia, no la clase.
// Node.js cachea los módulos — todo require('../queue/MemoryQueue')
// recibe el mismo objeto. Sin esto, worker y controller tendrían
// cada uno su propia cola vacía.
const queue = new MemoryQueue();
module.exports = queue;
