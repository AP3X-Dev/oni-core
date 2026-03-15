// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'examples/**', 'benchmarks/**'] },

  // Base for all TS
  ...tseslint.config({
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
    },
  }),

  // STRICT: production source — no explicit any
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // LENIENT: test files — warn only
  {
    files: ['src/**/*.test.ts', 'src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
