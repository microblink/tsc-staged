import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { findAffectedProjects, findProjectConfig, resolveFilePath } from "./path.ts";

const supportedExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(prefix: string): string {
  const directoryPath = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  temporaryDirectories.add(directoryPath);
  return directoryPath;
}

afterAll(() => {
  for (const directoryPath of temporaryDirectories) {
    rmSync(directoryPath, { force: true, recursive: true });
  }
});

function createRepository(files: Record<string, string>): string {
  const root = createTemporaryDirectory("tsc-staged-path-");

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  return root;
}

describe("resolveFilePath", () => {
  it("resolves a deleted file through its remaining directory", () => {
    const repositoryRoot = createRepository({ "src/deleted.ts": "export {};\n" });
    unlinkSync(path.join(repositoryRoot, "src/deleted.ts"));

    expect(resolveFilePath(repositoryRoot, "src/deleted.ts")).toBe(path.join(repositoryRoot, "src/deleted.ts"));
  });

  it("keeps the resolved path when the file and its directory are missing", () => {
    const repositoryRoot = createRepository({});
    const filePath = "missing/deleted.ts";

    expect(resolveFilePath(repositoryRoot, filePath)).toBe(path.join(repositoryRoot, filePath));
  });

  it("rejects a file outside the repository", () => {
    const repositoryRoot = createRepository({});
    const outsideRoot = createTemporaryDirectory("tsc-staged-outside-");
    const filePath = path.join(outsideRoot, "outside.ts");
    writeFileSync(filePath, "export {};\n");

    expect(() => resolveFilePath(repositoryRoot, filePath)).toThrow(
      `Staged file is outside the repository: ${filePath}`,
    );
  });

  it("rejects a relative path that escapes the repository", () => {
    const repositoryRoot = createRepository({});
    const filePath = "../outside.ts";

    expect(() => resolveFilePath(repositoryRoot, filePath)).toThrow(
      `Staged file is outside the repository: ${filePath}`,
    );
  });

  it("rejects a symlink whose real path is outside the repository", () => {
    const repositoryRoot = createRepository({ "src/index.ts": "export {};\n" });
    const outsideRoot = createTemporaryDirectory("tsc-staged-link-");
    const outsideFile = path.join(outsideRoot, "outside.ts");
    const filePath = path.join(repositoryRoot, "src/outside.ts");
    writeFileSync(outsideFile, "export {};\n");
    symlinkSync(outsideFile, filePath);

    expect(() => resolveFilePath(repositoryRoot, filePath)).toThrow(
      `Staged file is outside the repository: ${filePath}`,
    );
  });

  it("rejects a missing file below a symlinked directory outside the repository", () => {
    const repositoryRoot = createRepository({});
    const outsideRoot = createTemporaryDirectory("tsc-staged-link-");
    const filePath = "linked/missing/deleted.ts";
    symlinkSync(outsideRoot, path.join(repositoryRoot, "linked"));

    expect(() => resolveFilePath(repositoryRoot, filePath)).toThrow(
      `Staged file is outside the repository: ${filePath}`,
    );
  });
});

describe("findProjectConfig", () => {
  it("finds the nearest tsconfig.json", () => {
    const repositoryRoot = createRepository({
      "tsconfig.json": "{}\n",
      "packages/project/tsconfig.json": "{}\n",
      "packages/project/src/index.ts": "export {};\n",
    });
    const filePath = path.join(repositoryRoot, "packages/project/src/index.ts");

    expect(findProjectConfig(repositoryRoot, filePath)).toEqual({
      configPath: path.join(repositoryRoot, "packages/project/tsconfig.json"),
      realConfigPath: path.join(repositoryRoot, "packages/project/tsconfig.json"),
    });
  });

  it("returns the real path of a symlinked tsconfig.json", () => {
    const repositoryRoot = createRepository({
      "configs/tsconfig.json": "{}\n",
      "src/index.ts": "export {};\n",
    });
    symlinkSync(path.join(repositoryRoot, "configs/tsconfig.json"), path.join(repositoryRoot, "tsconfig.json"));

    expect(findProjectConfig(repositoryRoot, path.join(repositoryRoot, "src/index.ts"))).toEqual({
      configPath: path.join(repositoryRoot, "tsconfig.json"),
      realConfigPath: path.join(repositoryRoot, "configs/tsconfig.json"),
    });
  });

  it("does not walk above the repository root", () => {
    const parent = createTemporaryDirectory("tsc-staged-parent-");
    const repositoryRoot = path.join(parent, "repo");
    const filePath = path.join(repositoryRoot, "src/index.ts");
    writeFileSync(path.join(parent, "tsconfig.json"), "{}\n");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "export {};\n");

    expect(findProjectConfig(repositoryRoot, filePath)).toBeUndefined();
  });
});

describe("findAffectedProjects", () => {
  it("deduplicates files that share a tsconfig.json", () => {
    const repositoryRoot = createRepository({
      "tsconfig.json": "{}\n",
      "src/first.ts": "export const first = 1;\n",
      "src/second.ts": "export const second = 2;\n",
    });

    expect(
      findAffectedProjects(
        repositoryRoot,
        ["src/first.ts", path.join(repositoryRoot, "src/second.ts")],
        supportedExtensions,
      ),
    ).toEqual({
      projects: new Map([
        [
          path.join(repositoryRoot, "tsconfig.json"),
          {
            configPath: path.join(repositoryRoot, "tsconfig.json"),
            filePaths: [path.join(repositoryRoot, "src/first.ts"), path.join(repositoryRoot, "src/second.ts")],
          },
        ],
      ]),
      unconfiguredFiles: [],
    });
  });

  it("ignores unsupported files", () => {
    const repositoryRoot = createRepository({
      "tsconfig.json": "{}\n",
      "src/index.ts": "export {};\n",
      "README.md": "# readme\n",
    });

    expect(findAffectedProjects(repositoryRoot, ["src/index.ts", "README.md"], supportedExtensions)).toEqual({
      projects: new Map([
        [
          path.join(repositoryRoot, "tsconfig.json"),
          {
            configPath: path.join(repositoryRoot, "tsconfig.json"),
            filePaths: [path.join(repositoryRoot, "src/index.ts")],
          },
        ],
      ]),
      unconfiguredFiles: [],
    });
  });

  it("returns unique supported files without a project", () => {
    const repositoryRoot = createRepository({ "src/index.ts": "export {};\n" });
    const filePath = path.join(repositoryRoot, "src/index.ts");

    expect(findAffectedProjects(repositoryRoot, ["src/index.ts", filePath], supportedExtensions)).toEqual({
      projects: new Map(),
      unconfiguredFiles: [filePath],
    });
  });
});
