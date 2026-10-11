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
          ignoreCodes: [151002],
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
};
