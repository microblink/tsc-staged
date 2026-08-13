# tsc-staged

`tsc-staged` is a modern alternative to [`tsc-files`](https://github.com/gustavopch/tsc-files). Since the release of TypeScript 7, `tsc-files` is no longer maintained. The native TypeScript compiler is fast enough that staged-file checks don't provide any performance benefit.

**So why `tsc-staged`?**

`tsc-staged` doesn't type-check only staged files, but rather the full project in which these files are located. This is useful for large monorepos with many packages, where changes in one package shouldn't trigger a full type-check of the entire monorepo.

## Requirements

- Node.js 22 or newer
- TypeScript 6 or 7 installed locally in the project

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

## Use with `lint-staged` or `nano-staged`

```js
// lint-staged.config.js / nano-staged.mjs
export default {
  "**/*.{ts,tsx,mts,cts}": "tsc-staged",
};
```

`lint-staged` and `nano-staged` append matching file paths to the command. For each file,
`tsc-staged` finds the nearest `tsconfig.json`, deduplicates the affected projects, and runs:

```sh
tsc --project path/to/tsconfig.json --noEmit
```

Each affected project is checked in full, so errors in unstaged files are reported too. Projects
are checked sequentially and the command stops on the first failure. All project compiler settings,
including `skipLibCheck`, are preserved. No temporary configuration, JavaScript, or declaration
files are created. TypeScript may still update configured incremental build metadata.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
