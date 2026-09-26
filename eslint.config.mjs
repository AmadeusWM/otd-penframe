import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {ignores: ['dist/**', '.test-build/**', 'node_modules/**']},
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {files: ['extension/**/*.ts'], languageOptions: {globals: {global: 'readonly'}}},
    {files: ['tests/shell.ts'], languageOptions: {globals: {global: 'readonly', print: 'readonly'}}},
    {files: ['scripts/**/*.mjs'], languageOptions: {globals: {console: 'readonly', process: 'readonly'}}},
);
