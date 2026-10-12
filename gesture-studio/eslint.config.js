import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "test-results", "playwright-report", "public"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    // Domain code stays pure: no React, no browser globals.
    files: ["src/domain/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": ["error", { patterns: ["react", "react-dom", "react/*", "../runtime/*", "../features/*", "../ui/*", "../app/*"] }],
      "no-restricted-globals": ["error", "window", "document", "navigator", "performance", "localStorage", "indexedDB", "AudioContext", "fetch"],
    },
  },
  {
    // Tests may assert presence with `!` after an explicit expectation.
    files: ["tests/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
