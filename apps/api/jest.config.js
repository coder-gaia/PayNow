/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!main.ts', '!**/*.module.ts'],
  coverageDirectory: '../coverage',
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
};
