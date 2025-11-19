import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		plugins: {
			'simple-import-sort': simpleImportSort,
		},
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				ecmaVersion: 'latest',
			},
		},
		rules: {
			indent: [
				'error',
				'tab',
				{
					SwitchCase: 1,
					flatTernaryExpressions: true,
					offsetTernaryExpressions: false,
				},
			],
			'linebreak-style': ['error', 'unix'],
			quotes: ['error', 'single'],
			semi: ['error', 'always'],
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'no-fallthrough': 'off',
			'no-control-regex': 'off',
			'comma-dangle': [
				'error',
				{
					arrays: 'always-multiline',
					objects: 'always-multiline',
					imports: 'always-multiline',
					exports: 'always-multiline',
					functions: 'never',
				},
			],
			'key-spacing': [
				'error',
				{
					beforeColon: false,
					afterColon: true,
					mode: 'strict',
				},
			],
			'no-multi-spaces': [
				'error',
				{
					ignoreEOLComments: true,
				},
			],
			'keyword-spacing': [
				'error',
				{
					before: true,
					after: true,
				},
			],
			'no-multiple-empty-lines': [
				'error',
				{
					max: 1,
					maxEOF: 1,
					maxBOF: 0,
				},
			],
			'no-trailing-spaces': [
				'error',
				{
					skipBlankLines: false,
				},
			],
			'simple-import-sort/imports': 'error',
			'eol-last': ['error', 'always'],
			'comma-spacing': [
				'error',
				{
					before: false,
					after: true,
				},
			],
		},
	}
);
