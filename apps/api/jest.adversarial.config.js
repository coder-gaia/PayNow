/**
 * Suite adversarial.
 *
 * Config propria, e nao um arquivo a mais na suite ponta a ponta, por tres
 * motivos.
 *
 * O custo e outro: ela roda cada cenario duas vezes e leva minutos, enquanto as
 * outras suites levam segundos. Misturadas, o retorno rapido das outras
 * desaparece atras dela.
 *
 * A falha significa outra coisa: uma suite ponta a ponta vermelha aponta um
 * caso conhecido que quebrou, e esta aqui aponta um caso que ninguem tinha
 * pensado. Sao investigacoes diferentes, e merecem jobs separados no CI.
 *
 * E ela precisa rodar sozinha: `maxWorkers: 1` porque o gateway falso guarda
 * estado no processo, e dois cenarios em paralelo colheriam os desfechos um do
 * outro.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  testRegex: 'adversarial\\.e2e-spec\\.ts$',
  testTimeout: 30000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/support/env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};
