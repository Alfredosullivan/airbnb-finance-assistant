'use strict';

// validate — Factory de middleware para validación con Zod.
// Recibe un schema de Zod y devuelve un middleware Express que:
//   1. Parsea req.body contra el schema (con safeParse, nunca lanza)
//   2. Si falla → 400 con el primer mensaje de error del schema
//   3. Si pasa  → reemplaza req.body con los datos parseados (ya transformados:
//      strings trimeadas, email en minúsculas, etc.) y llama a next()
//
// ¿Por qué req.body = result.data?
// Zod no solo valida — también transforma (.trim(), .toLowerCase()).
// Al sobreescribir req.body, el controlador recibe datos ya limpios
// sin necesidad de volver a aplicar esas transformaciones.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Datos inválidos';
      return res.status(400).json({ error: message });
    }

    req.body = result.data;
    next();
  };
}

module.exports = { validate };
