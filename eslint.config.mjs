import globals from "globals";
import tseslint from "typescript-eslint";

// 1000 for unit conversions (ms per second).
const ALLOWED_MAGIC_NUMBERS = [-1, 0, 1, 2, 10, 100, 1000];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".worktrees/**", "prototypes/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: ALLOWED_MAGIC_NUMBERS,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "PropertyDefinition[key.name='dispose']",
          message:
            "Define `dispose` as a class method (`dispose() {}`), not a class field (`dispose = ...`).",
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='dispose']",
          message:
            "Reassigning `dispose` is not allowed. Define cleanup in the class `dispose()` method.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Use helpers from src/config.ts instead of process.env directly.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "PropertyDefinition[key.name='dispose']",
          message:
            "Define `dispose` as a class method (`dispose() {}`), not a class field (`dispose = ...`).",
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='dispose']",
          message:
            "Reassigning `dispose` is not allowed. Define cleanup in the class `dispose()` method.",
        },
        {
          selector:
            "Property[key.type='Identifier'][key.name='url'][value.type='Literal'][value.value=/^(https?|wss?):\\/\\//]",
          message:
            "Inline URL literals are not allowed on url properties. Use a named constant or env-backed configuration.",
        },
        {
          selector:
            "Property[key.type='Literal'][key.value='url'][value.type='Literal'][value.value=/^(https?|wss?):\\/\\//]",
          message:
            "Inline URL literals are not allowed on url properties. Use a named constant or env-backed configuration.",
        },
      ],
    },
  },
  {
    files: ["src/config.ts"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["src/browser/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "PropertyDefinition[key.name='dispose']",
          message:
            "Define `dispose` as a class method (`dispose() {}`), not a class field (`dispose = ...`).",
        },
        {
          selector: "AssignmentExpression[left.type='MemberExpression'][left.property.name='dispose']",
          message:
            "Reassigning `dispose` is not allowed. Define cleanup in the class `dispose()` method.",
        },
        {
          selector:
            "Property[key.type='Identifier'][key.name='url'][value.type='Literal'][value.value=/^(https?|wss?):\\/\\//]",
          message:
            "Inline URL literals are not allowed on url properties. Use runtime configuration passed from main instead.",
        },
        {
          selector:
            "Property[key.type='Literal'][key.value='url'][value.type='Literal'][value.value=/^(https?|wss?):\\/\\//]",
          message:
            "Inline URL literals are not allowed on url properties. Use runtime configuration passed from main instead.",
        },
        {
          selector: "Literal[value=/^(https?|wss?):\\/\\/localhost(?::\\d+)?/]",
          message:
            "Hardcoded localhost URLs are not allowed in renderer code. Use `televisionServerURL` runtime configuration.",
        },
      ],
    },
  },
  {
    // Storybook staging is display scaffolding — magic numbers are fine.
    files: ["storybook/**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
    },
  },
  {
    files: [
      "test/**/*.ts",
      "packages/*/test/**/*.ts",
      "packages/skillbench/test/**/*.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
    },
  },
);
