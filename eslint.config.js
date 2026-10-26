import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'data/**',
      'platforms/**',
      'plugins/**',
      'custom-plugins/**',
      'www/**',
      'dist-web/**',
      'extentions/**',
      '**/*.min.js',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    plugins: { prettier },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'no-throw-literal': 'warn',
      'no-dupe-keys': 'warn',
      'no-dupe-class-members': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
];
