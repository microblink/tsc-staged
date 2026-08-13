#!/usr/bin/env node

import { realpathSync } from "node:fs";

import { typecheckProjects } from "./compiler.ts";

const supportedExtensions = new Set<string>([".ts", ".tsx", ".mts", ".cts"]);
const repositoryRoot = realpathSync(process.cwd());

try {
  process.exitCode = typecheckProjects(repositoryRoot, process.argv.slice(2), supportedExtensions);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);

  process.exitCode = 1;
}
