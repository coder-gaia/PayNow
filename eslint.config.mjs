// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

/**
 * Duas decisões arquiteturais deste repositório são aplicadas aqui como erro
 * de lint, e não como convenção escrita:
 *
 *   ADR-0001  módulos de domínio não podem se importar entre si
 *   ADR-0009  o tempo é injetado, não lido do relógio do sistema
 *
 * Que as duas realmente disparam é verificado por `pnpm verify:architecture`,
 * que roda no CI. Uma regra que existe no arquivo mas não dispara é pior do
 * que nenhuma regra: ela dá a impressão de que a fronteira está protegida.
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
  // ADR-0009: o relógio é injetado.
  //
  // O módulo platform está fora da regra porque abriga a única implementação
  // autorizada do relógio, além de usos legítimos de hora de parede que não
  // são tempo de domínio, como o carimbo do probe de prontidão.
  // ---------------------------------------------------------------------
  {
    files: ['apps/api/src/modules/*/**/*.ts'],
    // O módulo platform abriga a única implementação autorizada do relógio.
    // Testes ficam de fora porque constroem instantes explícitos de propósito,
    // que é o oposto do acoplamento com tempo ambiente que a regra evita.
    ignores: ['apps/api/src/modules/platform/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'ADR-0009: use o Clock injetado (modules/platform/clock) em vez de acessar o relógio do sistema.',
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
  // ADR-0001: fronteiras entre módulos.
  //
  // Hierarquia permitida:
  //
  //   config    ->  config
  //   platform  ->  platform, config
  //   domínio   ->  platform, config, ele mesmo
  //   domínio   ->  outro domínio: o build quebra
  //
  // A raiz de composição (main.ts e app.module.ts) fica deliberadamente sem
  // classificação: é o único lugar cuja função é enxergar todos os módulos
  // para ligá-los.
  // ---------------------------------------------------------------------
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Padrões ancorados pelo fim (**/src/...) de propósito: o lint roda
      // tanto da raiz do repositório quanto de dentro de apps/api, e o plugin
      // resolve caminhos relativos ao diretório de execução. Padrão ancorado
      // no início fica inerte quando o lint roda de dentro do pacote, que é
      // como o script do package.json o executa.
      // O plugin resolve dependências via eslint-import-resolver-node, que por
      // padrão só conhece .js, .mjs, .json e .node. Sem isto, todo import
      // relativo entre arquivos .ts fica classificado como desconhecido e a
      // regra de fronteira não dispara em lugar nenhum, silenciosamente.
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

  // As respostas do supertest são tipadas como `any`, e tipar cada corpo de
  // resposta em teste só acrescentaria cerimônia: o que o teste afirma já é a
  // forma da resposta. As regras de `unsafe` são desligadas apenas aqui.
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  prettier,
);
