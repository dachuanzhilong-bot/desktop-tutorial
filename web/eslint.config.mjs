import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // the layers point one way: lib/ (logic without React screens) never depends on the screens (CLAUDE.md, REFACTOR_PLAN 2-3).
    // Type-only imports and the tests under src/lib/__tests__ count too.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:@/|(?:\\.{1,2}/)+)(?:components|app)(?:/|$)",
              message: "src/lib must not import from components/ or app/ (the screens depend on lib, not the other way round). Move the shared code or type into src/lib.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", "test-results/**", "playwright-report/**"]),
]);
