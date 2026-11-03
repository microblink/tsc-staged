# Changelog

## 1.0.0

- Type-check the TypeScript projects that contain your staged files
- Find the nearest tsconfig.json for each file and check each affected project only once
- Work with TypeScript 6 and TypeScript 7, using the first tsc or tsc6 compiler found in PATH
- Check the referenced projects of a solution-style tsconfig.json
- Check staged files through the referenced projects of tsconfig.json files in parent directories
- Check staged files that their nearest project excludes with the compiler options of that project, and skip files outside its rootDir
- Skip files that have no tsconfig.json in the repository and warn about them, while still checking other projects
- Run in lint-staged, nano-staged, or Vite+ staged configurations for .ts, .tsx, .mts, and .cts files
