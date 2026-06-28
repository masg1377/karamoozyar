import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit tests for pure client logic (message reconciliation, MIME helpers).
// Component/DOM tests can opt into environment 'jsdom' per-file via a
// `// @vitest-environment jsdom` pragma.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@karamooziyar/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
