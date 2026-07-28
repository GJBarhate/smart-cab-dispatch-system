import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests run through Vite so `import.meta.env` and the JSX transform
// behave exactly as they do in the app.
//
// `environment: 'node'` on purpose: these tests render with `renderToString`,
// which is enough to catch the class of bug they exist for — a component that
// throws while *building* its element tree. That needs no DOM, so the suite
// pulls in no jsdom/testing-library dependency at all.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}']
  }
});
