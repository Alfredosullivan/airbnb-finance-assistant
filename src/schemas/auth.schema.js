'use strict';

const { z } = require('zod');

// Schema de registro — valida y transforma los campos antes de llegar al controlador.
// .trim() y .toLowerCase() se ejecutan ANTES de las validaciones de longitud/formato,
// así un usuario con espacios extra o email en mayúsculas no recibe un error falso.
const RegisterSchema = z.object({
  username: z
    .string({ required_error: 'El nombre de usuario debe tener al menos 3 caracteres' })
    .trim()
    .min(3, 'El nombre de usuario debe tener al menos 3 caracteres'),
  email: z
    .string({ required_error: 'El email no tiene un formato válido' })
    .trim()
    .toLowerCase()
    .email('El email no tiene un formato válido'),
  password: z
    .string({ required_error: 'La contraseña debe tener al menos 6 caracteres' })
    .min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

// Schema de login — solo requiere que los campos existan y no estén vacíos.
// No validamos formato de email aquí: si el email no existe en la DB, el controlador
// devuelve 401 genérico (anti-enumeración). Validar formato aquí daría una pista extra.
const LoginSchema = z.object({
  email: z
    .string({ required_error: 'Email y contraseña son requeridos' })
    .trim()
    .toLowerCase()
    .min(1, 'Email y contraseña son requeridos'),
  password: z
    .string({ required_error: 'Email y contraseña son requeridos' })
    .min(1, 'Email y contraseña son requeridos'),
});

module.exports = { RegisterSchema, LoginSchema };
