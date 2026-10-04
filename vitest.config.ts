import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/fixtures/**', 'test/certificate/hunt/**', 'node_modules/**'],
    testTimeout: 60_000,
  },
});
