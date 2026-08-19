import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { type AffectedProject, findAffectedProjects } from "./path.ts";

interface Compiler {
  command: "tsc" | "tsc6";
  executablePath: string;
  pathKey: string;
  pathEnvironment: string;
}

function findEnvironmentKey(name: string): string | undefined {
  const normalizedName = process.platform === "win32" ? name.toLowerCase() : name;

  return Object.keys(process.env).find((key) => {
    const normalizedKey = process.platform === "win32" ? key.toLowerCase() : key;
    return normalizedKey === normalizedName;
  });
}

function canExecute(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findCompiler(invocationDirectory: string): Compiler {
  const pathKey = findEnvironmentKey("PATH");
  const pathEnvironment = pathKey === undefined ? undefined : process.env[pathKey];
  const pathExtensions =
    process.platform === "win32"
      ? (() => {
          const pathExtKey = findEnvironmentKey("PATHEXT");
          const pathExtEnvironment = pathExtKey === undefined ? undefined : process.env[pathExtKey];
          return pathExtEnvironment?.split(path.delimiter).filter(Boolean) ?? [];
        })()
      : [""];

  if (pathKey !== undefined && pathEnvironment !== undefined && pathExtensions.length > 0) {
    const directories = pathEnvironment
      .split(path.delimiter)
      .map((directory) => path.resolve(invocationDirectory, directory || "."));

    for (const directory of directories) {
      for (const command of ["tsc", "tsc6"] as const) {
        for (const extension of pathExtensions) {
          const executablePath = path.join(directory, `${command}${extension}`);

          if (canExecute(executablePath)) {
            return {
              command,
              executablePath,
              pathKey,
              pathEnvironment: directories.join(path.delimiter),
            };
          }
        }
      }
    }
  }

  throw new Error("Could not find tsc or tsc6. Install TypeScript in the project.");
}

function runCompiler(
  compiler: Compiler,
  configPath: string,
  mode: "listFiles" | "typecheck",
): SpawnSyncReturns<string> {
  const environment = { ...process.env, [compiler.pathKey]: compiler.pathEnvironment };
  const finalArgument = mode === "listFiles" ? "--listFilesOnly" : "--noEmit";
  const result = spawnSync(
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : compiler.executablePath,
    process.platform === "win32"
      ? ["/d", "/s", "/c", `${compiler.command} --project tsconfig.json ${finalArgument}`]
      : ["--project", "tsconfig.json", finalArgument],
    {
      cwd: path.dirname(configPath),
      encoding: "utf8",
      env: environment,
      stdio: mode === "listFiles" ? ["inherit", "pipe", "pipe"] : "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result;
}

function typecheckProject(compiler: Compiler, configPath: string): number {
  return runCompiler(compiler, configPath, "typecheck").status ?? 1;
}

function normalizePath(filePath: string): string {
  const realPath = realpathSync(filePath);
  return process.platform === "win32" ? realPath.toLowerCase() : realPath;
}

function findUncoveredFiles(compiler: Compiler, project: AffectedProject): { status: number; files: string[] } {
  const existingFiles = project.filePaths.filter((filePath) => existsSync(filePath));

  if (existingFiles.length === 0) {
    return { status: 0, files: [] };
  }

  const result = runCompiler(compiler, project.configPath, "listFiles");
  const status = result.status ?? 1;

  if (status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    return { status, files: [] };
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const configDirectory = path.dirname(project.configPath);
  const projectFiles = new Set(
    (result.stdout ?? "")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((filePath) => normalizePath(path.resolve(configDirectory, filePath))),
  );
  const files = existingFiles.filter((filePath) => !projectFiles.has(normalizePath(filePath)));

  return { status: 0, files };
}

function reportUncoveredFiles(repositoryRoot: string, uncoveredProjects: Map<AffectedProject, string[]>): void {
  console.error("Staged TypeScript files are not included in their nearest project:");

  for (const [project, filePaths] of uncoveredProjects) {
    console.error(`${path.relative(repositoryRoot, project.configPath)}:`);

    for (const filePath of filePaths) {
      console.error(`  ${path.relative(repositoryRoot, filePath)}`);
    }
  }

  console.error("Update the project configuration or exclude these files from the staged matcher.");
}

export function typecheckProjects(repositoryRoot: string, filePaths: string[], extensions: Set<string>): number {
  const { projects, unconfiguredFiles } = findAffectedProjects(repositoryRoot, filePaths, extensions);

  for (const filePath of unconfiguredFiles) {
    console.warn(`Skipping staged typecheck for ${path.relative(repositoryRoot, filePath)}: no tsconfig.json found`);
  }

  if (projects.size === 0) {
    return 0;
  }

  const compiler = findCompiler(repositoryRoot);
  const uncoveredProjects = new Map<AffectedProject, string[]>();

  for (const project of projects.values()) {
    const result = findUncoveredFiles(compiler, project);

    if (result.status !== 0) {
      return result.status;
    }

    if (result.files.length > 0) {
      uncoveredProjects.set(project, result.files);
    }
  }

  if (uncoveredProjects.size > 0) {
    reportUncoveredFiles(repositoryRoot, uncoveredProjects);
    return 1;
  }

  for (const project of projects.values()) {
    const status = typecheckProject(compiler, project.configPath);

    if (status !== 0) {
      return status;
    }
  }

  return 0;
}
