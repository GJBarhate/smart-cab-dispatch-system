import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ['src/tests/**/*.test.js'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
