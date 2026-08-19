import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export interface AffectedProject {
  configPath: string;
  filePaths: string[];
}

interface ProjectConfig {
  configPath: string;
  realConfigPath: string;
}

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

function findConfigPath(directoryPath: string, repositoryRoot: string): ProjectConfig | undefined {
  if (isInsideDirectory(directoryPath, repositoryRoot)) {
    const configPath = path.join(directoryPath, "tsconfig.json");

    if (existsSync(configPath)) {
      return {
        configPath,
        realConfigPath: realpathSync(configPath),
      };
    }

    if (directoryPath !== repositoryRoot) {
      return findConfigPath(path.dirname(directoryPath), repositoryRoot);
    }
  }

  return undefined;
}

export function findProjectConfig(repositoryRoot: string, filePath: string): ProjectConfig | undefined {
  return findConfigPath(path.dirname(filePath), repositoryRoot);
}

export function findAffectedProjects(
  repositoryRoot: string,
  filePaths: string[],
  extensions: Set<string>,
): { projects: Map<string, AffectedProject>; unconfiguredFiles: string[] } {
  const projects = new Map<string, AffectedProject>();
  const unconfiguredFiles: string[] = [];
  const seenFiles = new Set<string>();

  for (const filePath of filePaths) {
    if (!extensions.has(path.extname(filePath))) {
      continue;
    }

    const resolvedPath = resolveFilePath(repositoryRoot, filePath);

    if (seenFiles.has(resolvedPath)) {
      continue;
    }

    seenFiles.add(resolvedPath);

    const configPath = findProjectConfig(repositoryRoot, resolvedPath);

    if (configPath === undefined) {
      unconfiguredFiles.push(resolvedPath);
    } else {
      const project = projects.get(configPath.realConfigPath);

      if (project === undefined) {
        projects.set(configPath.realConfigPath, {
          configPath: configPath.configPath,
          filePaths: [resolvedPath],
        });
      } else {
        project.filePaths.push(resolvedPath);
      }
    }
  }

  return { projects, unconfiguredFiles };
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
