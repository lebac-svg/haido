// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', '.haido/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain JS/MJS files (scripts, probes) run on Node — declare its globals
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    rules: {
      // Bugs the type system does not catch on its own
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-floating-promises': 'off', // enable when type-aware linting is turned on
      eqeqeq: ['error', 'smart'],
    },
  },
);
