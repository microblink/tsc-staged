import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "tsc-staged-package-"));
const packageVersion = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version;

function runCommand(command: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding): string {
  return process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command, ...args], options)
    : execFileSync(command, args, options);
}

try {
  // Pack once so every check exercises the same publishable artifact.
  const packedName = runCommand("npm", ["pack", "--pack-destination", temporaryDirectory], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .at(-1);

  if (!packedName) {
    throw new Error("npm pack did not return a tarball name");
  }

  const packedPath = path.join(temporaryDirectory, packedName);

  // Install in isolated projects for each supported TypeScript generation
  for (const [version, compiler] of [
    ["6", "typescript@npm:@typescript/typescript6@6.0.2"],
    ["7", "typescript@7.0.2"],
  ] as const) {
    const consumerRoot = path.join(temporaryDirectory, `consumer-${version}`);

    mkdirSync(path.join(consumerRoot, "src"), { recursive: true });
    writeFileSync(path.join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n');
    writeFileSync(path.join(consumerRoot, "tsconfig.json"), '{"compilerOptions":{"strict":true},"include":["src"]}\n');
    writeFileSync(path.join(consumerRoot, "src/index.ts"), "export const value: string = 'ok';\n");

    runCommand("pnpm", ["add", "--ignore-workspace", "--save-dev", packedPath, compiler], {
      cwd: consumerRoot,
      encoding: "utf8",
      stdio: "inherit",
    });
    runCommand("pnpm", ["exec", "tsc-staged", "src/index.ts"], {
      cwd: consumerRoot,
      encoding: "utf8",
      stdio: "inherit",
    });

    // Confirm the installed CLI reports compiler errors
    writeFileSync(path.join(consumerRoot, "src/index.ts"), "export const value: string = 1;\n");

    let rejectedInvalidTypeScript = false;

    try {
      runCommand("pnpm", ["exec", "tsc-staged", "src/index.ts"], {
        cwd: consumerRoot,
        encoding: "utf8",
      });
    } catch (error) {
      if (typeof error !== "object" || error === null) {
        throw error;
      }

      const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
      const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      const output = stdout + stderr;

      if (!output.includes("TS2322")) {
        throw error;
      }

      rejectedInvalidTypeScript = true;
    }

    if (!rejectedInvalidTypeScript) {
      throw new Error(`Expected the packed CLI with TypeScript ${version} to reject invalid TypeScript`);
    }

    const manifest = JSON.parse(readFileSync(path.join(consumerRoot, "node_modules/tsc-staged/package.json"), "utf8"));

    if (manifest.version !== packageVersion) {
      throw new Error(`Expected packed version ${packageVersion}, got ${manifest.version}`);
    }
  }
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
