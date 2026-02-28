import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**'],
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
  moduleNameMapper: {
    '^@yojana-setu/shared$': '<rootDir>/../shared/src/index.ts',
  },
  globals: {
    'ts-jest': { tsconfig: { strict: true, esModuleInterop: true } },
  },
};

export default config;
