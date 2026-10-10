// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * ESLint flat config: recommended + strict typescript-eslint rules, plus project invariants
 * (no network modules, no exec/execSync in source).
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "test/fixtures/**", "examples/**/output/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:http", message: "Impact Check must not use the network." },
            { name: "node:https", message: "Impact Check must not use the network." },
            { name: "node:net", message: "Impact Check must not use the network." },
            {
              name: "node:child_process",
              importNames: ["exec", "execSync"],
              message: "Use spawn with argument arrays.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  }
);
