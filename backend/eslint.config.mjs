import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "jest.config.ts"] },

  js.configs.recommended,

  // Type-aware linting. The rules that catch the mistakes that actually hurt on a
  // backend — a floating promise, an unawaited async call — need type information,
  // so the plain (non-type-checked) preset is not enough.
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* A floating promise that rejects is an unhandled rejection, and an unhandled
       * rejection takes the process down. This is the single most valuable rule here. */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      /* `res.locals` is typed as `any` by Express, so reading a validated payload out of
       * it is unavoidably an `any` access. Warn rather than error: worth seeing, not
       * worth blocking a build over. */
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",

      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  {
    // Config files and migrations are not part of the app's type-checked source.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    /* Tests drive the app through supertest, whose `res.body` is `any` by design — it
     * is a JSON response, and the library cannot know its shape. Asserting on it trips
     * the whole no-unsafe-* family on almost every line, which drowns out real
     * findings. The assertions themselves are the type check here. */
    files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // Must come last: turns off every rule that would fight the formatter.
  prettier,
);
