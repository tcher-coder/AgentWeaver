import type { GitChangedFile } from "./git-types.js";

export function uniqueGitPaths(paths: string[]): string[] {
  return paths.filter((filePath, index, allPaths) => allPaths.indexOf(filePath) === index);
}

export function needsGitFileStage(file: Pick<GitChangedFile, "type" | "xy" | "workTreeStatus">): boolean {
  if (file.type === "untracked" || file.xy === "??") {
    return true;
  }
  return file.workTreeStatus !== " ";
}

export function selectChangedFilesForPaths(paths: string[], changedFiles: GitChangedFile[]): GitChangedFile[] {
  const filesByPath = new Map<string, GitChangedFile>();
  for (const file of changedFiles) {
    filesByPath.set(file.path, file);
    filesByPath.set(file.file, file);
  }

  return uniqueGitPaths(paths)
    .map((filePath) => filesByPath.get(filePath))
    .filter((file): file is GitChangedFile => file !== undefined);
}

export function selectPathsNeedingGitStage(paths: string[], changedFiles: GitChangedFile[]): string[] {
  return selectChangedFilesForPaths(paths, changedFiles)
    .filter(needsGitFileStage)
    .map((file) => file.path);
}
