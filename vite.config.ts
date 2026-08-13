import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**"],
    sortImports: true,
    sortPackageJson: {
      sortScripts: true,
    },
  },
  lint: {
    categories: {
      correctness: "error",
      perf: "warn",
      suspicious: "warn",
    },
    env: {
      builtin: true,
      node: true,
    },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      curly: "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
  },
  staged: {
    "**/*.{ts,tsx,mts,cts}": [
      "node src/index.ts",
      "vp lint --max-warnings=0",
      "vp fmt --check --no-error-on-unmatched-pattern",
      "vp test",
    ],
    "**/*.{js,cjs,mjs,jsx,json,jsonc,yaml,yml,css,md}": "vp fmt --check --no-error-on-unmatched-pattern",
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "json-summary"],
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
