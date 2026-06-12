import canvaPlugin from "@canva/app-eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist",
      "**/*.d.ts",
      "**/*.d.tsx",
      "**/*.config.*",
      "templates/**/*",
    ],
  },
  ...canvaPlugin.configs.apps_no_i18n,
  {
    files: [
      "src/**/*",
      // Currently only the localization examples are localized and following the
      // formatjs guidelines. If more examples are localized, this list should be
      // updated:
      "examples/localization/**/*",
    ],
    ...canvaPlugin.configs.apps_i18n,
  },
  {
    // Non-null assertions are convenient and safe in unit tests (e.g. asserting
    // on a known array index).
    files: ["**/__tests__/**/*", "**/*.tests.ts", "**/*.tests.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
