import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);

  if (relativePath === "") {
    return true;
  }

  if (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)) {
    return true;
  }

  return false;
}

function findConfigPath(directoryPath: string, repositoryRoot: string, filePath: string): string {
  if (isInsideDirectory(directoryPath, repositoryRoot)) {
    const configPath = path.join(directoryPath, "tsconfig.json");

    if (existsSync(configPath)) {
      return realpathSync(configPath);
    }

    if (directoryPath !== repositoryRoot) {
      return findConfigPath(path.dirname(directoryPath), repositoryRoot, filePath);
    }
  }

  throw new Error(`Could not find a tsconfig.json for ${path.relative(repositoryRoot, filePath)}`);
}

export function findProjectConfig(repositoryRoot: string, filePath: string): string {
  return findConfigPath(path.dirname(filePath), repositoryRoot, filePath);
}

export function findAffectedProjects(
  repositoryRoot: string,
  filePaths: string[],
  extensions: Set<string>,
): Set<string> {
  const projectConfigs = new Set<string>();

  for (const filePath of filePaths) {
    const resolvedPath = resolveFilePath(repositoryRoot, filePath);

    if (!extensions.has(path.extname(resolvedPath))) {
      continue;
    }

    projectConfigs.add(findProjectConfig(repositoryRoot, resolvedPath));
  }

  return projectConfigs;
}

function resolveThroughExistingAncestor(filePath: string): string {
  const missingPathParts: string[] = [];
  let existingPath = filePath;

  while (!existsSync(existingPath)) {
    missingPathParts.unshift(path.basename(existingPath));
    existingPath = path.dirname(existingPath);
  }

  return path.join(realpathSync(existingPath), ...missingPathParts);
}

export function resolveFilePath(repositoryRoot: string, filePath: string): string {
  const resolvedPath = path.resolve(repositoryRoot, filePath);
  const absolutePath = resolveThroughExistingAncestor(resolvedPath);

  if (!isInsideDirectory(absolutePath, repositoryRoot)) {
    throw new Error(`Staged file is outside the repository: ${filePath}`);
  }

  return absolutePath;
}
