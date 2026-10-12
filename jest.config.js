/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.base.json',
        isolatedModules: true,
        diagnostics: {
          ignoreCodes: [151002, 2345],
        },
      },
    ],
  },
  testMatch: [
    '<rootDir>/packages/*/test/**/*.test.ts',
    '<rootDir>/apps/*/test/**/*.spec.ts',
  ],
  moduleNameMapper: {
    '^@deployforge/(.*)$': '<rootDir>/packages/$1/src',
  },
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    'apps/*/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: '<rootDir>/coverage',
  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
};
