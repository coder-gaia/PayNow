// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

/**
 * A regra `boundaries/element-types` e a implementacao da ADR-001.
 * Modulos de dominio nao podem se importar entre si: a comunicacao entre eles
 * acontece por eventos que passam pelo outbox. Quebrar essa regra quebra o build.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/generated/**',
      '**/*.config.mjs',
      '**/*.config.js',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // ADR-008: o tempo e injetado. Acesso direto ao relogio do sistema e proibido
  // fora do modulo platform, que abriga a unica implementacao autorizada.
  {
    files: ['apps/api/src/modules/*/**/*.ts'],
    ignores: ['apps/api/src/modules/platform/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'ADR-008: use o Clock injetado (modules/platform/clock) em vez de acessar o relogio do sistema.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'ADR-008: use o Clock injetado (modules/platform/clock) em vez de `new Date()`.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'ADR-008: use o Clock injetado (modules/platform/clock) em vez de `Date.now()`.',
        },
      ],
    },
  },

  // ADR-001: fronteiras entre modulos.
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/api/src/**/*.ts'],
      'boundaries/elements': [
        { type: 'entrypoint', mode: 'file', pattern: 'apps/api/src/*.ts' },
        { type: 'config', mode: 'folder', pattern: 'apps/api/src/config' },
        { type: 'platform', mode: 'folder', pattern: 'apps/api/src/modules/platform' },
        {
          type: 'domain',
          mode: 'folder',
          pattern: 'apps/api/src/modules/*',
          capture: ['module'],
        },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: 'ADR-001: ${file.type} nao pode importar ${dependency.type}.',
          rules: [
            { from: 'entrypoint', allow: ['entrypoint', 'config', 'platform', 'domain'] },
            { from: 'config', allow: ['config'] },
            { from: 'platform', allow: ['platform', 'config'] },
            {
              from: 'domain',
              allow: ['platform', 'config', ['domain', { module: '${from.module}' }]],
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
