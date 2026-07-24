import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-implicit-globals": "error",
      "no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["*.config.js", "scripts/**/*.js", "server/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Playwright tests run in Node but addInitScript / evaluate bodies execute
    // in the browser, so allow both global sets.
    files: ["test-e2e/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "test-results/**", "public/**"],
  },
];
