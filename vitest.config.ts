import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: {},
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'prototypes', '_archive'],
    environment: 'node',
  },
});
