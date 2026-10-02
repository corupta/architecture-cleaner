import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/fixtures/**', 'node_modules/**'],
    testTimeout: 60_000,
  },
});
