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

interface Run {
  repositoryRoot: string;
  compiler: Compiler;
  passedProjects: Map<string, Map<string, string>>;
}

interface ProjectConfig {
  compilerOptions?: { rootDir?: string };
  files?: string[];
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

function splitListedFiles(output: string): { listedFiles: Map<string, string>; messages: string[] } {
  const listedFiles = new Map<string, string>();
  const messages: string[] = [];

  for (const line of output.split(/\r?\n/u)) {
    if (path.isAbsolute(line) && existsSync(line)) {
      listedFiles.set(normalizePath(line), line);
    } else {
      messages.push(line);
    }
  }

  return { listedFiles, messages };
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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

function listProjectFiles(compiler: Compiler, configPath: string): Map<string, string> {
  const result = runCompiler(compiler, configPath, ["--listFilesOnly"]);
  return result.status === 0 ? splitListedFiles(result.stdout).listedFiles : new Map();
}

function runCheck(
  compiler: Compiler,
  configPath: string,
): { status: number; signal: NodeJS.Signals | null; listedFiles: Map<string, string> } {
  const prettyArgs = process.stdout.isTTY ? ["--pretty"] : [];
  const result = runCompiler(compiler, configPath, ["--noEmit", "--listFiles", ...prettyArgs]);
  const { listedFiles, messages } = splitListedFiles(result.stdout);

  process.stdout.write(messages.join("\n"));
  process.stderr.write(result.stderr);

  if (messages.some((message) => message.includes("TS6305"))) {
    console.error("Referenced projects are not built. Run tsc --build once, then try again.");
  }

  return { status: result.status ?? 1, signal: result.signal, listedFiles };
}

function ignoreSignal(): void {}

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
    `${JSON.stringify({
      extends: `./${path.basename(configPath)}`,
      compilerOptions: { composite: false, incremental: false },
      files,
      include: [],
    })}\n`,
  );

  let signal: NodeJS.Signals | null = null;
  process.on("SIGINT", ignoreSignal);

  try {
    const result = runCheck(compiler, temporaryConfigPath);
    signal = result.signal;
    return result.status;
  } finally {
    rmSync(temporaryConfigPath, { force: true });
    process.off("SIGINT", ignoreSignal);

    if (signal !== null) {
      process.kill(process.pid, signal);
    }
  }
}

function findAncestorConfigs(repositoryRoot: string, configPath: string): string[] {
  const ancestorConfigs: string[] = [];
  let directory = path.dirname(configPath);

  while (isInsideDirectory(directory, repositoryRoot)) {
    directory = path.dirname(directory);
    const ancestorConfig = path.join(directory, "tsconfig.json");

    if (existsSync(ancestorConfig)) {
      ancestorConfigs.push(ancestorConfig);
    }
  }

  return ancestorConfigs;
}

function checkReferences(
  run: Run,
  referencedConfigs: string[],
  filePaths: string[],
  checkAll: boolean,
): { status: number; uncoveredFiles: string[] } {
  let uncoveredFiles = filePaths;

  for (const referencedConfig of referencedConfigs) {
    if (uncoveredFiles.length === 0 && !checkAll) {
      break;
    }

    const referencedFiles =
      run.passedProjects.get(referencedConfig) ?? listProjectFiles(run.compiler, referencedConfig);
    const coveredFiles = uncoveredFiles.filter((filePath) => referencedFiles.has(normalizePath(filePath)));

    if (coveredFiles.length > 0 || checkAll) {
      const status = checkProject(run, referencedConfig, coveredFiles);

      if (status !== 0) {
        return { status, uncoveredFiles };
      }

      uncoveredFiles = uncoveredFiles.filter((filePath) => !coveredFiles.includes(filePath));
    }
  }

  return { status: 0, uncoveredFiles };
}

function checkProject(run: Run, configPath: string, filePaths: string[]): number {
  const { repositoryRoot, compiler } = run;
  const passedFiles = run.passedProjects.get(configPath);
  const { status, listedFiles } =
    passedFiles === undefined ? runCheck(compiler, configPath) : { status: 0, listedFiles: passedFiles };

  if (status !== 0) {
    return status;
  }

  run.passedProjects.set(configPath, listedFiles);

  const existingFiles = filePaths.filter((filePath) => existsSync(filePath));
  const hasDeletedFiles = existingFiles.length < filePaths.length;
  let uncoveredFiles = existingFiles.filter((filePath) => !listedFiles.has(normalizePath(filePath)));

  if (uncoveredFiles.length === 0 && !hasDeletedFiles) {
    return status;
  }

  const config = readConfig(compiler, configPath);
  const referencedConfigs = findReferencedConfigs(configPath, config);
  const isSolution = referencedConfigs.length > 0 && (config.files ?? []).length === 0;
  const referenceResult = checkReferences(run, referencedConfigs, uncoveredFiles, hasDeletedFiles && isSolution);

  if (referenceResult.status !== 0) {
    return referenceResult.status;
  }

  uncoveredFiles = referenceResult.uncoveredFiles;

  for (const ancestorConfig of findAncestorConfigs(repositoryRoot, configPath)) {
    if (uncoveredFiles.length === 0) {
      break;
    }

    const enclosingConfigs = findReferencedConfigs(ancestorConfig, readConfig(compiler, ancestorConfig)).filter(
      (referencedConfig) =>
        referencedConfig !== configPath &&
        uncoveredFiles.some((filePath) => isInsideDirectory(filePath, path.dirname(referencedConfig))),
    );
    const ancestorResult = checkReferences(run, enclosingConfigs, uncoveredFiles, false);

    if (ancestorResult.status !== 0) {
      return ancestorResult.status;
    }

    uncoveredFiles = ancestorResult.uncoveredFiles;
  }

  if (isSolution) {
    for (const filePath of uncoveredFiles) {
      console.warn(`Skipping staged typecheck for ${relativePath(repositoryRoot, filePath)}: no project includes it`);
    }

    return status;
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

  const declarationFiles = [...listedFiles.values()].filter(
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

  const run: Run = { repositoryRoot, compiler: findCompiler(repositoryRoot), passedProjects: new Map() };

  for (const project of projects.values()) {
    const status = checkProject(run, project.configPath, project.filePaths);

    if (status !== 0) {
      return status;
    }
  }

  return 0;
}
