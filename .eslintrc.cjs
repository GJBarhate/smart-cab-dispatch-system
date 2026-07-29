module.exports = {
  root: true,
  env: { node: true, es2022: true, browser: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['react-hooks', 'react'],
  extends: [
    'eslint:recommended',
    'plugin:react-hooks/recommended'
  ],
  ignorePatterns: [
    'dist', 'build', 'node_modules', '**/src/shared/**', 'coverage',
    '*.config.js', '*.config.cjs', '*.config.mjs'
  ],
  rules: {
    // Plain espree (unlike @typescript-eslint's scope analysis) doesn't know
    // that `<Foo />` references the `Foo` binding, so no-unused-vars would
    // otherwise flag every lazy-loaded route component as unused.
    'react/jsx-uses-vars': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off'
  }
};
