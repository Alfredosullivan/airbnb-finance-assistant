'use strict';

const { z } = require('zod');

// Schema compartido por createProperty y renameProperty.
// .trim() garantiza que '   ' (solo espacios) falle la validación min(1).
const PropertyNameSchema = z.object({
  name: z
    .string({ required_error: 'El nombre de la propiedad es requerido' })
    .trim()
    .min(1, 'El nombre de la propiedad es requerido'),
});

module.exports = { PropertyNameSchema };
