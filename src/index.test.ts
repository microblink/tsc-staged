import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vite-plus/test";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliPath = path.join(repositoryRoot, "src/index.ts");
const compilerBins = {
  6: path.join(repositoryRoot, "node_modules/typescript/bin/tsc6"),
  7: path.join(repositoryRoot, "node_modules/@typescript/native/bin/tsc"),
};
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(prefix: string): string {
  const directoryPath = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.add(directoryPath);
  return directoryPath;
}

afterAll(() => {
  for (const directoryPath of temporaryDirectories) {
    rmSync(directoryPath, { force: true, recursive: true });
  }
});

function createProject(
  files: Record<string, string>,
  root = createTemporaryDirectory("tsc-staged-"),
  compilerOptions: Record<string, unknown> = { strict: true },
): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions, include: ["src"] })}\n`);

  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(root, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  return root;
}

function runCli(cwd: string, files: string[], compilerVersion: 6 | 7 = 7) {
  const compilerPackage = path.dirname(path.dirname(compilerBins[compilerVersion]));
  const nodeModules = path.join(cwd, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  symlinkSync(compilerPackage, path.join(nodeModules, "typescript"), "junction");

  return spawnSync(process.execPath, [cliPath, ...files], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });
}

describe.each([6, 7] as const)("TypeScript %s", (compilerVersion) => {
  it("checks the full affected project", () => {
    const root = createProject({
      "src/staged.ts": "export const value: string = 'ok';\n",
      "src/unstaged.ts": "export const value: string = 1;\n",
    });

    const result = runCli(root, ["src/staged.ts"], compilerVersion);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("TS2322");
  });

  it("honors the project's skipLibCheck setting", () => {
    const root = createProject(
      {
        "src/broken.d.ts": ["interface Value { property: string }", "interface Value { property: number }", ""].join(
          "\n",
        ),
        "src/index.ts": "export {};\n",
      },
      undefined,
      { skipLibCheck: true, strict: true },
    );

    const result = runCli(root, ["src/index.ts"], compilerVersion);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

it.each(["tsx", "mts", "cts"])("checks .%s files", (extension) => {
  const filePath = `src/index.${extension}`;
  const root = createProject({ [filePath]: "export const value: string = 1;\n" });

  const result = runCli(root, [filePath]);

  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("TS2322");
});

it("checks files in multiple projects", () => {
  const root = createTemporaryDirectory("tsc-staged-multi-");
  writeFileSync(path.join(root, "package.json"), '{"private":true}\n');

  const first = createProject({ "src/index.ts": "export const first: string = 'ok';\n" }, path.join(root, "first"));
  const second = createProject({ "src/index.ts": "export const second: string = 'ok';\n" }, path.join(root, "second"));
  const result = runCli(root, [path.join(first, "src/index.ts"), path.join(second, "src/index.ts")]);

  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("stops after the first failing project", () => {
  const root = createTemporaryDirectory("tsc-staged-fail-fast-");
  const first = createProject({ "src/index.ts": "export const first: string = 1;\n" }, path.join(root, "first"));
  const second = createProject({ "src/index.ts": "export const second = 2;\n" }, path.join(root, "second"), {
    unknownCompilerOption: true,
  });

  const result = runCli(root, [path.join(first, "src/index.ts"), path.join(second, "src/index.ts")]);
  const output = result.stdout + result.stderr;

  expect(result.status).not.toBe(0);
  expect(output).toContain("TS2322");
  expect(output).not.toContain("unknownCompilerOption");
});

it("ignores unsupported files and succeeds without a compiler", () => {
  const root = createTemporaryDirectory("tsc-staged-empty-");
  const result = spawnSync(process.execPath, [cliPath, "README.md"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });

  expect(result.status).toBe(0);
});
