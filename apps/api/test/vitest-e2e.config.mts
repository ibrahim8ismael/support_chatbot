import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * E2E specs boot the Nest app against real infrastructure (testcontainers
 * Postgres & Redis, mocked Chatwoot/models — docs/contributing/development.md).
 * Run serially: shared containers, no cross-test parallelism.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
