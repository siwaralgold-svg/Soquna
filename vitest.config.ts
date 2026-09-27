import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          include: ['apps/api/test/**/*.test.ts'],
          setupFiles: ['apps/api/test/setup-env.ts'],
          // Each file creates its own database; running files one at a time keeps
          // Redis rate-limit counters from interfering across files.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/domain/src/**', 'apps/api/src/**'],
      exclude: ['**/*.test.ts', 'apps/api/src/server.ts', 'apps/api/src/scripts/**'],
      thresholds: {
        // Business rules (state machines, money, screening) must be fully tested.
        'packages/domain/src/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
