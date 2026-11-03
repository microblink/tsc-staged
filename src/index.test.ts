import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

function createSolutionProject(files: Record<string, string>): string {
  const root = createProject(files);
  writeFileSync(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify({ files: [], references: [{ path: "./tsconfig.node.json" }, { path: "./app" }] })}\n`,
  );
  writeFileSync(
    path.join(root, "tsconfig.node.json"),
    `${JSON.stringify({ compilerOptions: { composite: true, noEmit: true, strict: true }, files: ["node.ts"] })}\n`,
  );
  writeFileSync(path.join(root, "node.ts"), "export const node: string = 'ok';\n");
  mkdirSync(path.join(root, "app"));
  writeFileSync(
    path.join(root, "app/tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { composite: true, noEmit: true, strict: true }, include: ["../src"] })}\n`,
  );
  return root;
}

function runCli(cwd: string, files: string[], compilerVersion: 6 | 7 = 7) {
  const compilerDirectory = path.join(cwd, "compiler-bin");
  const compilerName = compilerVersion === 6 ? "tsc6" : "tsc";
  mkdirSync(compilerDirectory, { recursive: true });

  if (process.platform === "win32") {
    writeFileSync(
      path.join(compilerDirectory, `${compilerName}.CMD`),
      `@"${process.execPath}" "${compilerBins[compilerVersion]}" %*\r\n`,
    );
  } else {
    symlinkSync(compilerBins[compilerVersion], path.join(compilerDirectory, compilerName));
  }

  return spawnSync(process.execPath, [cliPath, ...files], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: [compilerDirectory, process.env.PATH].filter(Boolean).join(path.delimiter) },
  });
}

function writeCompiler(directory: string, name: "tsc" | "tsc6", output: string, status = 0): void {
  mkdirSync(directory, { recursive: true });
  const projectFile = path.join(path.dirname(directory), "src/index.ts");

  if (process.platform === "win32") {
    writeFileSync(
      path.join(directory, `${name}.CMD`),
      ["@echo off", `@echo ${output}`, `@echo ${projectFile}`, `@exit /b ${status}`, ""].join("\r\n"),
    );
  } else {
    const compilerPath = path.join(directory, name);
    writeFileSync(
      compilerPath,
      ["#!/bin/sh", `printf '%s\\n' '${output}' '${projectFile}'`, `exit ${status}`, ""].join("\n"),
    );
    chmodSync(compilerPath, 0o755);
  }
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

  it("checks a staged file outside the project with the project's options", () => {
    const root = createProject({
      "src/env.d.ts": "declare const projectGlobal: string;\n",
      "src/index.ts": "export {};\n",
      "test/excluded.ts": "export const value: number = projectGlobal;\n",
    });

    const result = runCli(root, ["test/excluded.ts"], compilerVersion);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("TS2322");
    expect(readdirSync(root)).not.toContainEqual(expect.stringMatching(/^\.tsconfig/u));
  });

  it("skips a staged file outside the project's rootDir", () => {
    const root = createProject(
      { "src/index.ts": "export {};\n", "vite.config.ts": "export const value: string = 1;\n" },
      undefined,
      { rootDir: "src", strict: true },
    );

    const result = runCli(root, ["vite.config.ts"], compilerVersion);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain("Skipping staged typecheck for vite.config.ts: outside rootDir");
  });

  it("checks the referenced project of a solution-style config", () => {
    const root = createSolutionProject({ "src/index.ts": "export const value: string = 1;\n" });

    const result = runCli(root, ["src/index.ts"], compilerVersion);

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("TS2322");
  });

  it("accepts an excluded staged file reached through an import", () => {
    const root = createProject({
      "src/index.ts": 'export { value } from "../test/helper.js";\n',
      "test/helper.ts": "export const value = 1;\n",
    });

    const result = runCli(root, ["test/helper.ts"], compilerVersion);

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
  const second = createProject({ "src/index.ts": "export const second = missingValue;\n" }, path.join(root, "second"));

  const result = runCli(root, [path.join(first, "src/index.ts"), path.join(second, "src/index.ts")]);
  const output = result.stdout + result.stderr;

  expect(result.status).not.toBe(0);
  expect(output).toContain("TS2322");
  expect(output).not.toContain("TS2304");
});

it("checks a project selected only by a deleted file", () => {
  const root = createProject({
    "src/index.ts": "export {};\n",
    "src/deleted.ts": "export {};\n",
  });
  unlinkSync(path.join(root, "src/deleted.ts"));

  const result = runCli(root, ["src/deleted.ts"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("checks every referenced project when a file is deleted from a solution-style config", () => {
  const root = createSolutionProject({ "src/index.ts": 'export { value } from "./deleted.js";\n' });

  const result = runCli(root, ["src/deleted.ts"]);

  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("TS2307");
});

it("checks a staged file outside every referenced project", () => {
  const root = createSolutionProject({
    "src/index.ts": "export {};\n",
    "test/excluded.ts": "export const value: string = 1;\n",
  });

  const result = runCli(root, ["test/excluded.ts"]);

  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("TS2322");
});

it("checks a staged file through a project referenced by a parent config", () => {
  const root = createTemporaryDirectory("tsc-staged-parent-");
  createProject(
    { "src/index.ts": "export {};\n", "test/index.test.ts": "export const value: string = 1;\n" },
    path.join(root, "packages/a"),
    { rootDir: "src", strict: true },
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify({ files: [], references: [{ path: "./packages/a" }, { path: "./tsconfig.tests.json" }] })}\n`,
  );
  writeFileSync(
    path.join(root, "tsconfig.tests.json"),
    `${JSON.stringify({ compilerOptions: { strict: true }, include: ["packages/*/test"] })}\n`,
  );

  const result = runCli(root, ["packages/a/test/index.test.ts"]);

  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("TS2322");
});

it("explains missing output of referenced projects", () => {
  const root = createProject({ "src/index.ts": "export {};\n" });
  const compilerDirectory = path.join(root, "compiler-bin");
  writeCompiler(compilerDirectory, "tsc", "error TS6305: Output file has not been built from source file.", 2);

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: compilerDirectory },
  });

  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Referenced projects are not built. Run tsc --build once, then try again.");
});

it("does not check the dependencies of a project with a deleted file", () => {
  const root = createTemporaryDirectory("tsc-staged-deleted-dependency-");
  createProject({ "src/index.ts": "export const value: string = 1;\n" }, path.join(root, "dependency"), {
    composite: true,
    strict: true,
  });
  const app = createProject({ "src/index.ts": "export {};\n" }, path.join(root, "app"));
  writeFileSync(
    path.join(app, "tsconfig.json"),
    `${JSON.stringify({ include: ["src"], references: [{ path: "../dependency" }] })}\n`,
  );

  const result = runCli(root, ["app/src/deleted.ts"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it.skipIf(process.platform === "win32")("handles compiler output larger than the default buffer", () => {
  const root = createProject({ "src/index.ts": "export {};\n" });
  const compilerDirectory = path.join(root, "compiler-bin");
  const compilerPath = path.join(compilerDirectory, "tsc");
  mkdirSync(compilerDirectory);
  writeFileSync(
    compilerPath,
    `#!/bin/sh\ni=0\nwhile [ $i -lt 20000 ]; do echo '${path.join(root, "src/index.ts")}'; i=$((i + 1)); done\n`,
  );
  chmodSync(compilerPath, 0o755);

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: compilerDirectory },
  });

  expect(result.status, result.stderr).toBe(0);
});

it.skipIf(process.platform === "win32")("removes the temporary config when interrupted", () => {
  const root = createProject({ "src/index.ts": "export {};\n", "test/excluded.ts": "export {};\n" });
  const compilerDirectory = path.join(root, "compiler-bin");
  const compilerPath = path.join(compilerDirectory, "tsc");
  mkdirSync(compilerDirectory);
  writeFileSync(
    compilerPath,
    [
      "#!/bin/sh",
      'case "$2" in',
      `  tsconfig.json) [ "$3" = --showConfig ] && echo '{}' || echo '${path.join(root, "src/index.ts")}' ;;`,
      "  *) kill -INT $PPID; kill -INT $$ ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(compilerPath, 0o755);

  const result = spawnSync(process.execPath, [cliPath, "test/excluded.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: compilerDirectory },
  });

  expect(result.signal, result.stderr).toBe("SIGINT");
  expect(readdirSync(root)).not.toContainEqual(expect.stringMatching(/^\.tsconfig/u));
});

it("preserves compiler errors from project membership discovery", () => {
  const root = createProject({ "src/index.ts": "export {};\n" }, undefined, { unknownCompilerOption: true });

  const result = runCli(root, ["src/index.ts"]);

  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("unknownCompilerOption");
});

it("runs a symlinked config from its logical directory", () => {
  const root = createTemporaryDirectory("tsc-staged-symlinked-config-");
  mkdirSync(path.join(root, "configs"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "configs/tsconfig.json"), '{"compilerOptions":{"strict":true},"include":["src"]}\n');
  writeFileSync(path.join(root, "src/index.ts"), "export {};\n");
  symlinkSync(path.join(root, "configs/tsconfig.json"), path.join(root, "tsconfig.json"));

  const result = runCli(root, ["src/index.ts"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it.skipIf(process.platform !== "win32")("handles Windows compiler shims from paths with shell characters", () => {
  const root = createProject({ "src/index.ts": "export {};\n" }, createTemporaryDirectory("tsc-staged & windows-"));

  const result = runCli(root, ["src/index.ts"]);

  expect(result.status, result.stdout + result.stderr).toBe(0);
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

it("warns for supported files without a project and succeeds without a compiler", () => {
  const root = createTemporaryDirectory("tsc-staged-unconfigured-");
  const filePath = path.join(root, "script.ts");
  writeFileSync(filePath, "export {};\n");

  const result = spawnSync(process.execPath, [cliPath, "script.ts", filePath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: "" },
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("Skipping staged typecheck for script.ts: no tsconfig.json found\n");
});

it("prefers tsc within the first compiler directory", () => {
  const root = createProject({ "src/index.ts": "export {};\n" });
  const compilerDirectory = path.join(root, "compiler-bin");
  writeCompiler(compilerDirectory, "tsc", "typescript-7");
  writeCompiler(compilerDirectory, "tsc6", "typescript-6");

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: compilerDirectory },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("typescript-7");
  expect(result.stdout).not.toContain("typescript-6");
});

it("respects compiler directory order before command preference", () => {
  const root = createProject({ "src/index.ts": "export {};\n" });
  const firstDirectory = path.join(root, "first-bin");
  const secondDirectory = path.join(root, "second-bin");
  writeCompiler(firstDirectory, "tsc6", "local-typescript-6");
  writeCompiler(secondDirectory, "tsc", "later-typescript-7");

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: [firstDirectory, secondDirectory].join(path.delimiter) },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("local-typescript-6");
  expect(result.stdout).not.toContain("later-typescript-7");
});

it("does not fall back after the selected compiler fails", () => {
  const root = createProject({ "src/index.ts": "export {};\n" });
  const compilerDirectory = path.join(root, "compiler-bin");
  writeCompiler(compilerDirectory, "tsc", "selected-failure", 2);
  writeCompiler(compilerDirectory, "tsc6", "unexpected-fallback");

  const result = spawnSync(process.execPath, [cliPath, "src/index.ts"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: compilerDirectory },
  });

  expect(result.status).toBe(2);
  expect(result.stdout).toContain("selected-failure");
  expect(result.stdout).not.toContain("unexpected-fallback");
});
