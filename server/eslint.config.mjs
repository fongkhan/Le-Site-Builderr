// Lint du serveur : règles recommandées d'ESLint, CommonJS pour les .js, modules pour
// les .mjs (tests, scripts). Le code TypeScript (payload.config.ts, app/) relève du
// typecheck (npm run typecheck) ; dépendances, build Next, données et migrations générées
// sont ignorés.
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  // Déstructuration qui écarte des champs (const { id, ...rest } = doc) : volontaire
  'no-unused-vars': ['error', { ignoreRestSiblings: true }],
};

export default [
  { ignores: ['node_modules/', '.next/', 'app/', 'uploads/', 'data/', 'migrations/'] },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules, ...rules },
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules, ...rules },
  },
];
