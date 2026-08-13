import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { findAffectedProjects } from "./path.ts";

function findCompilerBin(manifest: unknown): string | undefined {
  if (typeof manifest !== "object" || manifest === null || !("bin" in manifest)) {
    return undefined;
  }

  const { bin } = manifest;

  if (typeof bin === "string") {
    return bin;
  }

  if (typeof bin !== "object" || bin === null) {
    return undefined;
  }

  const tsc = "tsc" in bin ? bin.tsc : undefined;
  const tsc6 = "tsc6" in bin ? bin.tsc6 : undefined;

  return typeof tsc === "string" ? tsc : typeof tsc6 === "string" ? tsc6 : undefined;
}

function findCompiler(repositoryRoot: string): string {
  const require = createRequire(path.join(repositoryRoot, "package.json"));
  let manifestPath: string;

  try {
    manifestPath = require.resolve("typescript/package.json");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") {
      throw new Error("Could not find TypeScript. Install it in the project.", { cause: error });
    }

    throw error;
  }

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const compilerPath = findCompilerBin(manifest);

  if (compilerPath === undefined) {
    throw new Error("The locally installed TypeScript package does not provide tsc or tsc6.");
  }

  return path.resolve(path.dirname(manifestPath), compilerPath);
}

function typecheckProject(compilerPath: string, configPath: string): number {
  const result = spawnSync(process.execPath, [compilerPath, "--project", configPath, "--noEmit"], {
    cwd: path.dirname(configPath),
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

export function typecheckProjects(repositoryRoot: string, filePaths: string[], extensions: Set<string>): number {
  const projectConfigs = findAffectedProjects(repositoryRoot, filePaths, extensions);

  if (projectConfigs.size === 0) {
    return 0;
  }

  const compilerPath = findCompiler(repositoryRoot);

  for (const configPath of projectConfigs) {
    const status = typecheckProject(compilerPath, configPath);

    if (status !== 0) {
      return status;
    }
  }

  return 0;
}
