// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Duas decisoes arquiteturais deste repositorio sao aplicadas aqui como erro
 * de lint, e nao como convencao escrita:
 *
 *   ADR-0001  modulos de dominio nao podem se importar entre si
 *   ADR-0009  o tempo e injetado, nao lido do relogio do sistema
 *
 * Que as duas realmente disparam e verificado por `pnpm verify:architecture`,
 * que roda no CI. Uma regra que existe no arquivo mas nao dispara e pior do
 * que nenhuma regra: ela da a impressao de que a fronteira esta protegida.
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
      'tools/**/*.mjs',
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

  // ---------------------------------------------------------------------
  // ADR-0009: o relogio e injetado.
  //
  // O modulo platform esta fora da regra porque abriga a unica implementacao
  // autorizada do relogio, alem de usos legitimos de hora de parede que nao
  // sao tempo de dominio, como o carimbo do probe de prontidao.
  // ---------------------------------------------------------------------
  {
    files: ['apps/api/src/modules/*/**/*.ts'],
    ignores: ['apps/api/src/modules/platform/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'ADR-0009: use o Clock injetado (modules/platform/clock) em vez de acessar o relogio do sistema.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'ADR-0009: use o Clock injetado (modules/platform/clock) em vez de `new Date()`.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'ADR-0009: use o Clock injetado (modules/platform/clock) em vez de `Date.now()`.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // ADR-0001: fronteiras entre modulos.
  //
  // Hierarquia permitida:
  //
  //   config    ->  config
  //   platform  ->  platform, config
  //   dominio   ->  platform, config, ele mesmo
  //   dominio   ->  outro dominio: o build quebra
  //
  // A raiz de composicao (main.ts e app.module.ts) fica deliberadamente sem
  // classificacao: e o unico lugar cuja funcao e enxergar todos os modulos
  // para liga-los.
  // ---------------------------------------------------------------------
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Padroes ancorados pelo fim (**/src/...) de proposito: o lint roda
      // tanto da raiz do repositorio quanto de dentro de apps/api, e o plugin
      // resolve caminhos relativos ao diretorio de execucao. Padrao ancorado
      // no inicio fica inerte quando o lint roda de dentro do pacote, que e
      // como o script do package.json o executa.
      // O plugin resolve dependencias via eslint-import-resolver-node, que por
      // padrao so conhece .js, .mjs, .json e .node. Sem isto, todo import
      // relativo entre arquivos .ts fica classificado como desconhecido e a
      // regra de fronteira nao dispara em lugar nenhum, silenciosamente.
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] },
      },
      'boundaries/include': ['**/src/**/*.ts'],
      'boundaries/elements': [
        { type: 'config', pattern: '**/src/config' },
        { type: 'platform', pattern: '**/src/modules/platform' },
        { type: 'domain', pattern: '**/src/modules/*', capture: ['module'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'config' } },
              allow: { to: { element: { type: 'config' } } },
            },
            {
              from: { element: { type: 'platform' } },
              allow: { to: { element: { types: { anyOf: ['platform', 'config'] } } } },
            },
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { types: { anyOf: ['platform', 'config'] } } } },
            },
            {
              from: { element: { type: 'domain' } },
              allow: {
                to: { element: { type: 'domain', captured: { module: '{{from.module}}' } } },
              },
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
