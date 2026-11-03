import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { findAffectedProjects } from "./path.ts";

interface Compiler {
  command: "tsc" | "tsc6";
  executablePath: string;
  pathKey: string;
  pathEnvironment: string;
}

interface ProjectConfig {
  compilerOptions?: { rootDir?: string };
  references?: { path: string }[];
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

function runCompiler(compiler: Compiler, configPath: string, args: string[]): SpawnSyncReturns<string> {
  const environment = { ...process.env, [compiler.pathKey]: compiler.pathEnvironment };
  const compilerArgs = ["--project", path.basename(configPath), ...args];
  const result = spawnSync(
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : compiler.executablePath,
    process.platform === "win32" ? ["/d", "/s", "/c", [compiler.command, ...compilerArgs].join(" ")] : compilerArgs,
    {
      cwd: path.dirname(configPath),
      encoding: "utf8",
      env: environment,
      maxBuffer: Number.POSITIVE_INFINITY,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result;
}

function normalizePath(filePath: string): string {
  const realPath = realpathSync(filePath);
  return process.platform === "win32" ? realPath.toLowerCase() : realPath;
}

function relativePath(from: string, to: string): string {
  return path.relative(from, to).replaceAll(path.sep, "/");
}

function splitListedFiles(output: string): { listedFiles: Set<string>; messages: string[] } {
  const listedFiles = new Set<string>();
  const messages: string[] = [];

  for (const line of output.split(/\r?\n/u)) {
    if (path.isAbsolute(line) && existsSync(line)) {
      listedFiles.add(normalizePath(line));
    } else {
      messages.push(line);
    }
  }

  return { listedFiles, messages };
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readConfig(compiler: Compiler, configPath: string): ProjectConfig {
  const result = runCompiler(compiler, configPath, ["--showConfig"]);
  return result.status === 0 ? JSON.parse(result.stdout) : {};
}

function findReferencedConfigs(configPath: string, config: ProjectConfig): string[] {
  return (config.references ?? []).map((reference) => {
    const referencePath = path.resolve(path.dirname(configPath), reference.path);
    return statSync(referencePath, { throwIfNoEntry: false })?.isDirectory()
      ? path.join(referencePath, "tsconfig.json")
      : referencePath;
  });
}

function listProjectFiles(compiler: Compiler, configPath: string): Set<string> {
  const result = runCompiler(compiler, configPath, ["--listFilesOnly"]);
  return result.status === 0 ? splitListedFiles(result.stdout).listedFiles : new Set();
}

function runCheck(compiler: Compiler, configPath: string): { status: number; listedFiles: Set<string> } {
  const prettyArgs = process.stdout.isTTY ? ["--pretty"] : [];
  const result = runCompiler(compiler, configPath, ["--noEmit", "--listFiles", ...prettyArgs]);
  const { listedFiles, messages } = splitListedFiles(result.stdout);

  process.stdout.write(messages.join("\n"));
  process.stderr.write(result.stderr);

  return { status: result.status ?? 1, listedFiles };
}

function checkUncoveredFiles(
  compiler: Compiler,
  configPath: string,
  filePaths: string[],
  declarationFiles: string[],
): number {
  const configDirectory = path.dirname(configPath);
  const temporaryConfigPath = path.join(configDirectory, `.tsconfig.tsc-staged-${randomUUID()}.json`);
  const files = [...filePaths, ...declarationFiles];

  writeFileSync(
    temporaryConfigPath,
    `${JSON.stringify({ extends: `./${path.basename(configPath)}`, files, include: [] })}\n`,
  );

  try {
    return runCheck(compiler, temporaryConfigPath).status;
  } finally {
    rmSync(temporaryConfigPath, { force: true });
  }
}

function checkProject(repositoryRoot: string, compiler: Compiler, configPath: string, filePaths: string[]): number {
  const { status, listedFiles } = runCheck(compiler, configPath);

  if (status !== 0) {
    return status;
  }

  const existingFiles = filePaths.filter((filePath) => existsSync(filePath));
  const hasDeletedFiles = existingFiles.length < filePaths.length;
  let uncoveredFiles = existingFiles.filter((filePath) => !listedFiles.has(normalizePath(filePath)));

  if (uncoveredFiles.length === 0 && !hasDeletedFiles) {
    return status;
  }

  const config = readConfig(compiler, configPath);

  for (const referencedConfig of findReferencedConfigs(configPath, config)) {
    const referencedFiles = listProjectFiles(compiler, referencedConfig);
    const coveredFiles = uncoveredFiles.filter((filePath) => referencedFiles.has(normalizePath(filePath)));

    if (coveredFiles.length > 0 || hasDeletedFiles) {
      const referenceStatus = checkProject(repositoryRoot, compiler, referencedConfig, coveredFiles);

      if (referenceStatus !== 0) {
        return referenceStatus;
      }

      uncoveredFiles = uncoveredFiles.filter((filePath) => !coveredFiles.includes(filePath));
    }
  }

  const rootDir = config.compilerOptions?.rootDir;
  const rootDirectory = rootDir === undefined ? undefined : path.resolve(path.dirname(configPath), rootDir);
  const normalizedRootDirectory =
    rootDirectory !== undefined && existsSync(rootDirectory) ? normalizePath(rootDirectory) : rootDirectory;
  const checkableFiles = uncoveredFiles.filter((filePath) => {
    if (normalizedRootDirectory === undefined || isInsideDirectory(normalizePath(filePath), normalizedRootDirectory)) {
      return true;
    }

    console.warn(`Skipping staged typecheck for ${relativePath(repositoryRoot, filePath)}: outside rootDir`);
    return false;
  });

  if (checkableFiles.length === 0) {
    return status;
  }

  const declarationFiles = [...listedFiles].filter(
    (filePath) => /\.d\.[cm]?ts$/u.test(filePath) && !filePath.split(path.sep).includes("node_modules"),
  );

  return checkUncoveredFiles(compiler, configPath, checkableFiles, declarationFiles);
}

export function typecheckProjects(repositoryRoot: string, filePaths: string[], extensions: Set<string>): number {
  const { projects, unconfiguredFiles } = findAffectedProjects(repositoryRoot, filePaths, extensions);

  for (const filePath of unconfiguredFiles) {
    console.warn(`Skipping staged typecheck for ${relativePath(repositoryRoot, filePath)}: no tsconfig.json found`);
  }

  if (projects.size === 0) {
    return 0;
  }

  const compiler = findCompiler(repositoryRoot);

  for (const project of projects.values()) {
    const status = checkProject(repositoryRoot, compiler, project.configPath, project.filePaths);

    if (status !== 0) {
      return status;
    }
  }

  return 0;
}
