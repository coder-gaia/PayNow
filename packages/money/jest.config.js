/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!index.ts'],
  coverageDirectory: '../coverage',
  coverageThreshold: {
    global: { branches: 90, functions: 95, lines: 95, statements: 95 },
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};
