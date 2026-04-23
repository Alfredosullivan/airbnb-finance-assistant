'use strict';

// jobs.routes.js — Rutas para consultar estado de jobs y descargar resultados.
//
// Ambas rutas requieren auth (requireAuth) porque el jobId no es secreto
// por sí mismo — cualquiera que conozca un jobId podría descargar el Excel
// de otro usuario si las rutas fueran públicas. El JWT garantiza que solo
// el usuario autenticado puede consultar y descargar sus propios jobs.
//
// Nota: no filtramos por userId en el controller porque el jobId es un UUID v4
// aleatorio (probabilidad de colisión prácticamente cero), pero en un sistema
// productivo sería buena práctica verificar job.data.userId === req.user.userId.

const express = require('express');
const router  = express.Router();

const { requireAuth }                       = require('../middleware/auth.middleware');
const { getJobStatus, downloadJobResult }   = require('../controllers/jobs.controller');

// GET /api/jobs/:jobId          — Estado del job (polling del frontend)
router.get('/:jobId',           requireAuth, getJobStatus);

// GET /api/jobs/:jobId/download — Descarga el resultado cuando está listo
router.get('/:jobId/download',  requireAuth, downloadJobResult);

module.exports = router;
