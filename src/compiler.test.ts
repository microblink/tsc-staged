import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vite-plus/test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = path.join(repositoryRoot, "src/index.ts");
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "tsc-staged-compiler-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

it("requires TypeScript to be installed locally", () => {
  const root = createTemporaryDirectory();
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "tsconfig.json"), '{"include":["src"]}\n');
  writeFileSync(path.join(root, "src/index.ts"), "export {};\n");

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: path.join(repositoryRoot, "node_modules/.bin") },
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Install it in the project");
});
