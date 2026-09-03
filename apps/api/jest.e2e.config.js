/**
 * Testes ponta a ponta. Exigem PostgreSQL e Redis de pe (pnpm infra:up).
 * Rodam separados dos unitarios para que `pnpm test` continue valendo em
 * qualquer maquina, com ou sem Docker.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  testRegex: '.*\.e2e-spec\.ts$',
  testTimeout: 30000,
  // Ver o comentario em test/support/env.ts: desliga o cron de fundo, que
  // entregaria a fila do outbox por baixo das suites.
  setupFiles: ['<rootDir>/support/env.ts'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};
