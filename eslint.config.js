// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'examples/**', 'benchmarks/**', 'packages/*/dist/**'] },

  // Base for all TS (root + workspace packages)
  ...tseslint.config({
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
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
    files: ['src/**/*.ts', 'packages/*/src/**/*.ts'],
    ignores: [
      'src/**/*.test.ts', 'src/__tests__/**/*.ts',
      'packages/*/src/**/*.test.ts', 'packages/*/src/__tests__/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // LENIENT: test files — warn only
  {
    files: [
      'src/**/*.test.ts', 'src/__tests__/**/*.ts',
      'packages/*/src/**/*.test.ts', 'packages/*/src/__tests__/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
