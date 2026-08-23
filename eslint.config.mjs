import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Archivos del backend — controllers, services, repositories, etc.
    files: ['src/**/*.js', 'index.js', 'scripts/**/*.js', 'bin/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Permite variables con prefijo _ como convención de "intencionalmente no usado"
      // Cubre: args de función, variables locales, variables en catch, y destructuring de arrays
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // Permite bloques catch vacíos cuando el error se nombra con _ (convención intencional)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Archivos de test — necesitan los globales de Jest (describe, expect, it, etc.)
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
