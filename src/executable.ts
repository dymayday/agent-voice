import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ExecutablePathInput {
  shimPath: string;
  cwd?: string;
}

export interface ExecutablePaths {
  rootDir: string;
  indexTs: string;
}

function realpathOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function resolveExecutablePaths(input: ExecutablePathInput): ExecutablePaths {
  const realShimPath = realpathOrResolved(input.shimPath);
  const rootDir = dirname(dirname(realShimPath));
  return {
    rootDir,
    indexTs: join(rootDir, "src", "index.ts"),
  };
}
