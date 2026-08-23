import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Solo analiza archivos del backend — el frontend tiene su propia config en client/
    files: ['src/**/*.js', 'index.js', 'tests/**/*.js', 'scripts/**/*.js', 'bin/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Variables globales de Node.js disponibles sin importar
        ...globals.node,
      },
    },
  },
];
