import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import i18next from 'eslint-plugin-i18next';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    // The contracts entry point pulls in zod (~90 KB gzipped). Browser code may import its
    // types, but runtime values must come from '@souqna/contracts/constants'.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@souqna/contracts',
              allowTypeImports: true,
              message:
                "Import values from '@souqna/contracts/constants' to keep zod out of the bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    // All user-facing text must come from the i18n message files, never hard-coded in JSX.
    files: ['src/**/*.tsx'],
    ...i18next.configs['flat/recommended'],
    rules: {
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name=/^(alt|title|placeholder|aria-label)$/] > Literal[value=/\\S/]',
          message: 'User-visible attributes must come from the i18n message files.',
        },
      ],
    },
  },
];

export default config;
