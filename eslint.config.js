import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
	{ ignores: ['**/dist', '**/node_modules', '**/target', '**/src-tauri/target', '**/*.d.ts'] },
	{
		files: ['**/*.{ts,tsx}'],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: 'module',
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},
	{
		files: ['apps/spindle-lab/src/**/*.{ts,tsx}'],
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		files: ['eslint.config.js', 'apps/spindle-lab/vite.config.ts'],
		languageOptions: {
			globals: globals.node,
		},
	},
);
