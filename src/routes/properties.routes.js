// properties.routes.js — Rutas para gestión de propiedades Airbnb
// Todas requieren autenticación JWT (middleware requireAuth)
// Montadas bajo el prefijo /api/properties en index.js

/**
 * @swagger
 * tags:
 *   name: Properties
 *   description: Manage the user's Airbnb rental properties
 */

/**
 * @swagger
 * /api/properties:
 *   get:
 *     summary: List all properties belonging to the authenticated user
 *     tags: [Properties]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Array of properties (may be empty)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 properties:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Property'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   post:
 *     summary: Create a new property
 *     tags: [Properties]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Departamento Roma
 *     responses:
 *       201:
 *         description: Property created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 property:
 *                   $ref: '#/components/schemas/Property'
 *       400:
 *         description: Missing or blank name
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @swagger
 * /api/properties/{id}:
 *   put:
 *     summary: Rename an existing property
 *     tags: [Properties]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Property ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Casa Condesa
 *     responses:
 *       200:
 *         description: Property renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 name:
 *                   type: string
 *                   example: Casa Condesa
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Property not found or does not belong to this user
 *   delete:
 *     summary: Delete a property and all its associated reports
 *     tags: [Properties]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Property ID
 *     responses:
 *       200:
 *         description: Property deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Cannot delete the only property — user must keep at least one
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Property not found or does not belong to this user
 */

const express      = require('express');
const router       = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const {
  listProperties,
  createProperty,
  renameProperty,
  deleteProperty,
  getCombinedReport,
} = require('../controllers/properties.controller');

// GET  /api/properties               → Lista todas las propiedades del usuario
router.get('/',               requireAuth, listProperties);

// POST /api/properties               → Crea una nueva propiedad  { name }
router.post('/',              requireAuth, createProperty);

// GET  /api/properties/combined/:year → Reporte anual combinado (todas las propiedades)
// IMPORTANTE: debe estar antes de /:id para que "combined" no sea interpretado como un id
router.get('/combined/:year', requireAuth, getCombinedReport);

// PUT  /api/properties/:id           → Renombra una propiedad  { name }
router.put('/:id',            requireAuth, renameProperty);

// DELETE /api/properties/:id         → Elimina una propiedad y sus reportes
router.delete('/:id',         requireAuth, deleteProperty);

module.exports = router;
