import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  clearMocks: true,
  // Don't load the real config module (needs .env)
  moduleNameMapper: {
    '^../../shared/config$': '<rootDir>/__tests__/__mocks__/config.ts',
    '^../shared/config$': '<rootDir>/__tests__/__mocks__/config.ts',
    '^../../shared/logger$': '<rootDir>/__tests__/__mocks__/logger.ts',
    '^../shared/logger$': '<rootDir>/__tests__/__mocks__/logger.ts',
  },
};

export default config;
