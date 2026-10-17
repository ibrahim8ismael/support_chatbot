import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  plugins: [
    // NestJS decorators need emitDecoratorMetadata, which esbuild does not
    // provide — compile tests with SWC instead.
    swc.vite({
      // Explicitly set the module type so it does not inherit from .swcrc.
      module: { type: 'es6' },
    }),
  ],
});
