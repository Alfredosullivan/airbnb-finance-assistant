'use strict';

// jobs.controller.js — Controller para consultar estado de jobs y descargar resultados.
//
// El patrón de polling funciona así:
//   1. Cliente hace POST /api/excel/queue → recibe { jobId, status: 'pending' }
//   2. Cada 3 s el cliente hace GET /api/jobs/:jobId → recibe { status: 'active' | 'completed' | 'failed' }
//   3. Cuando status === 'completed', cliente hace GET /api/jobs/:jobId/download → recibe el .xlsx
//
// ¿Por qué no usar WebSockets o Server-Sent Events?
// Polling es más simple de implementar y depurar, y para este caso de uso
// (1 job por usuario a la vez, completado en < 30 s) es más que suficiente.
// WebSockets añadirían complejidad de infraestructura sin beneficio real.
//
// ¿Por qué no devolver el buffer directamente en el GET /:jobId/download?
// El buffer del Excel puede pesar 500KB–2MB. Si lo devolviéramos en el
// GET /:jobId (el endpoint de polling), el cliente descargaría megabytes
// en cada tick de polling. Separar el status del download es más eficiente.

const queue = require('../queue/MemoryQueue');

/**
 * GET /api/jobs/:jobId
 * Devuelve el estado actual del job. Sin el buffer — solo metadatos livianos.
 * El cliente hace polling a este endpoint cada 3 segundos.
 */
const getJobStatus = (req, res) => {
  const { jobId } = req.params;
  const job       = queue.getJob(jobId);

  if (!job) {
    // 404 si el job no existe o ya fue limpiado por cleanup()
    return res.status(404).json({ error: 'Job no encontrado o expirado' });
  }

  // Nunca incluir job.result.buffer en esta respuesta (puede ser pesado).
  // Solo filename cuando está listo — para que el frontend sepa qué mostrar.
  res.json({
    id:        job.id,
    type:      job.type,
    status:    job.status,        // pending | active | completed | failed
    error:     job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    filename:  job.result?.filename || null,
  });
};

/**
 * GET /api/jobs/:jobId/download
 * Disponible solo cuando job.status === 'completed'.
 * Convierte el base64 almacenado en el resultado de vuelta a Buffer binario.
 *
 * ¿Por qué 409 Conflict cuando no está listo?
 * El job existe (no es 404) pero está en un estado conflictivo con la acción
 * solicitada (descargar). 409 es más semántico que 400 en este contexto.
 */
const downloadJobResult = (req, res) => {
  const { jobId } = req.params;
  const job       = queue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado o expirado' });
  }

  if (job.status !== 'completed') {
    // Incluir el status actual para que el cliente pueda decidir si reintentar
    return res.status(409).json({
      error:  'El job aún no está listo para descargar',
      status: job.status,
    });
  }

  // Reconstruir el Buffer desde la representación base64 guardada en memoria
  const buffer = Buffer.from(job.result.buffer, 'base64');

  res.setHeader('Content-Type',        job.result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${job.result.filename}"`);
  res.setHeader('Content-Length',      buffer.length);
  res.send(buffer);
};

module.exports = { getJobStatus, downloadJobResult };
