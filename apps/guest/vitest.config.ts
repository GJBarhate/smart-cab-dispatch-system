import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Mirrors apps/admin/vitest.config.ts — see the reasoning there. Tests run
// through Vite so `import.meta.env` resolves, and in a node environment because
// `renderToString` needs no DOM, which keeps jsdom/testing-library out of the
// dependency tree.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
});
