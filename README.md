# tsc-staged

`tsc-staged` type-checks the TypeScript projects that contain your staged files. It is a modern alternative to [`tsc-files`](https://github.com/gustavopch/tsc-files), which is archived.

**So why `tsc-staged`?**

`tsc` cannot check a list of files with the settings from a `tsconfig.json`. Since TypeScript 6, `tsc file.ts` stops with an error when a `tsconfig.json` is present. Tools like `tsc-files` work around this with a temporary `tsconfig.json` that contains only the staged files.

The native TypeScript 7 compiler is fast enough that checks of only the staged files give no large performance benefit. `tsc-staged` therefore checks the full project of each staged file. In a large monorepo with many packages, a change in one package does not start a type-check of the entire monorepo.

## Requirements

- Node.js 22 or newer
- TypeScript 6 or 7 installed locally in the project

Run `tsc-staged` through the project's package manager or staged-file runner. It uses the first compiler exposed through `PATH`, preferring `tsc` over `tsc6` when both are in the same directory. One invocation uses one compiler; monorepos with different compiler versions need separate scoped invocations.

## Installation

```sh
npm i -D tsc-staged
```

```sh
pnpm add -D tsc-staged
```

```sh
yarn add -D tsc-staged
```

```sh
bun add -d tsc-staged
```

## Use with `lint-staged`, `nano-staged` or `Vite+`

```js
// lint-staged.config.js / nano-staged.mjs
export default {
  "**/*.{ts,tsx,mts,cts}": "tsc-staged",
};
```

```ts
// vite.config.ts - For usage with Vite+ and `vp staged`
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "**/*.{ts,tsx,mts,cts}": "tsc-staged",
  },
});
```

For each file, `tsc-staged` finds the nearest `tsconfig.json`, deduplicates the affected projects, and runs:

```sh
tsc --project path/to/tsconfig.json --noEmit
```

Files without a `tsconfig.json` inside the repository are skipped with a warning. Other affected projects are still checked.

Every existing staged TypeScript file must be part of its nearest project's compiler program. If a file is excluded, update the project configuration or narrow the staged-file matcher. Deleted files still select their nearest project.

Each affected project is checked in full, so errors in unstaged files are reported as well. Projects are checked sequentially and the command stops on the first failure.

## Comparison with other tools

- `tsc --build` with project references also checks only the projects that changed. If your monorepo uses project references, you possibly do not need `tsc-staged`. `tsc-staged` runs `tsc --project`, so it does not build referenced projects first.
- Oxlint and Vite+ can report TypeScript errors with type-aware linting and `typeCheck`. This requires TypeScript 7 and does not support all `tsconfig.json` options. Use `tsc-staged` if you want the result of the TypeScript compiler itself.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
