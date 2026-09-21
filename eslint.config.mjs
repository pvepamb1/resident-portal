import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * TypeScript 7.0.2 is pinned per ARCHITECTURE-SPINE.md's Stack table.
 * `typescript-eslint` (the package eslint-config-next depends on) hard-fails
 * at import time on any TypeScript >= 7.0 -- there is no released version
 * that supports it yet (tracked upstream:
 * https://github.com/typescript-eslint/typescript-eslint/issues/10940).
 * That rules out eslint-config-next entirely for this project as long as
 * TS 7 is pinned, not just its type-aware rules.
 *
 * This config gets equivalent coverage without that dependency: Babel's
 * TypeScript preset parses .ts/.tsx syntax (stripping types, no dependency
 * on the `typescript` package's version at all), combined with the same
 * React/React Hooks/Next.js rule sets eslint-config-next would otherwise
 * wire up. Type-checking itself is still fully covered -- by `tsc --noEmit`
 * and `next build`'s own TypeScript pass -- this file only replaces
 * *syntax linting*, which never needed type information.
 */
export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: (await import('@babel/eslint-parser')).default,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-react', '@babel/preset-typescript'],
        },
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off',
      // Babel's parser can't see TS types, so it can't tell an
      // interface/type-only reference from an unused variable -- `tsc`
      // already covers real unused-symbol detection with full type info.
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'db/migrations/**'],
  },
];
