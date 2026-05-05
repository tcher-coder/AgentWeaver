import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import { parsePorcelain } from "../../git/git-status-parser.js";
import type { GitChangedFile } from "../../git/git-types.js";
import { printInfo } from "../../tui.js";
import type { PipelineNodeDefinition } from "../types.js";

export { parsePorcelain } from "../../git/git-status-parser.js";

export type GitStatusFileEntry = GitChangedFile;

export type GitStatusNodeParams = {
  outputFile: string;
  diffOutputFile?: string;
  labelText?: string;
};

export type GitStatusNodeResult = {
  files: GitStatusFileEntry[];
  diff: string;
  diffStat: string;
};

function persistGitStatus(filePath: string, result: GitStatusNodeResult): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export const gitStatusNode: PipelineNodeDefinition<GitStatusNodeParams, GitStatusNodeResult> = {
  kind: "git-status",
  version: 1,
  async run(context, params) {
    printInfo(params.labelText ?? "Collecting git status");

    const porcelainOutput = await context.runtime.runCommand(
      ["git", "status", "--porcelain"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git status",
      },
    );

    const files = parsePorcelain(porcelainOutput);

    if (files.length === 0) {
      throw new TaskRunnerError("No changed files to commit.");
    }

    const diff = await context.runtime.runCommand(
      ["git", "diff"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff",
      },
    );

    const stagedDiff = await context.runtime.runCommand(
      ["git", "diff", "--cached"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff --cached",
      },
    );

    const fullDiff = stagedDiff + diff;

    const diffStat = await context.runtime.runCommand(
      ["git", "diff", "--stat"],
      {
        dryRun: context.dryRun,
        verbose: context.verbose,
        label: "git diff --stat",
      },
    );

    const result: GitStatusNodeResult = {
      files,
      diff: fullDiff,
      diffStat,
    };

    writeFileSync(params.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");

    if (params.diffOutputFile) {
      writeFileSync(params.diffOutputFile, fullDiff, "utf8");
    }

    return {
      value: result,
    };
  },
};
