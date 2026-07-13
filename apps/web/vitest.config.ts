import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit tests for pure client logic (message reconciliation, MIME helpers).
// Component/DOM tests can opt into environment 'jsdom' per-file via a
// `// @vitest-environment jsdom` pragma.
export default defineConfig({
  // Component tests (jsdom pragma) render the app's actual .tsx components,
  // which rely on Next.js/SWC's automatic JSX runtime (no explicit `import
  // React` in component files). Vite's default esbuild JSX transform must be
  // told to use the same "automatic" runtime, or React component files fail
  // with "React is not defined" under vitest even though they build fine
  // under `next build`.
  esbuild: {
    jsx: 'automatic',
  },
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
