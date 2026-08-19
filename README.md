# tsc-staged

`tsc-staged` is a modern alternative to [`tsc-files`](https://github.com/gustavopch/tsc-files). Since the release of TypeScript 7, `tsc-files` is no longer maintained. The native TypeScript compiler is fast enough that staged-file checks don't provide any performance benefit.

**So why `tsc-staged`?**

`tsc-staged` doesn't type-check only staged files, but rather the full project in which these files are located. This is useful for large monorepos with many packages, where changes in one package shouldn't trigger a full type-check of the entire monorepo.

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

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
