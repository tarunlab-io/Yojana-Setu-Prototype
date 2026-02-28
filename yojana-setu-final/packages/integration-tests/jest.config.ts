import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/scenarios'],
  testMatch: ['**/*.test.ts'],
  // Integration tests run sequentially — they share real DB state
  runInBand: true,
  // 60 second timeout per test (real services + DB calls)
  testTimeout: 60_000,
  // Global setup/teardown (wait for services)
  globalSetup: '<rootDir>/src/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/src/helpers/global-teardown.ts',
  moduleNameMapper: {
    '^@yojana-setu/shared$': '<rootDir>/../shared/src/index.ts',
  },
  globals: {
    'ts-jest': {
      tsconfig: { strict: false, esModuleInterop: true },
    },
  },
  // Clear test data between suites
  clearMocks: true,
  // Verbose output shows each test name in CI logs
  verbose: true,
};

export default config;
