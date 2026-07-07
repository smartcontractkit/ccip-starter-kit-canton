// @ts-check
import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import { createNodeResolver, flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import { configs as tseslintConfigs } from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', 'config/canton-config.json'],
  },
  eslint.configs.recommended,
  eslintPluginPrettierRecommended,
  importXFlatConfigs.recommended,
  {
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
      'import-x/external-module-folders': ['node_modules', 'node_modules/@types'],
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx', '.cts', '.mts'] },
    },
    rules: {
      'import-x/named': 'off',
    },
  },
  ...tseslintConfigs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    settings: {
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx', '.cjs', '.mjs'],
        }),
      ],
    },
    rules: {
      'import-x/order': [
        'warn',
        {
          groups: ['builtin', ['external', 'internal'], ['parent', 'sibling', 'index']],
          'newlines-between': 'always',
          named: { enabled: true, import: true, export: true, types: 'types-first' },
          alphabetize: { order: 'asc' },
        },
      ],
      'import-x/no-duplicates': ['warn', { 'prefer-inline': true }],
    },
  },
)
