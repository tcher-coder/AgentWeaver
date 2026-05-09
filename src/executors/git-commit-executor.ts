import { selectPathsNeedingGitStage, uniqueGitPaths } from "../git/git-stage-selection.js";
import { parsePorcelain } from "../git/git-status-parser.js";
import type { ExecutorContext, ExecutorDefinition, JsonObject } from "./types.js";

export type GitCommitExecutorConfig = JsonObject;

export type GitCommitExecutorInput = {
  message: string;
  files: string[];
  editEnabled?: boolean;
};

export type GitCommitExecutorResult = {
  output: string;
  commitHash: string | null;
};

export const gitCommitExecutor: ExecutorDefinition<
  GitCommitExecutorConfig,
  GitCommitExecutorInput,
  GitCommitExecutorResult
> = {
  kind: "git-commit",
  version: 1,
  defaultConfig: {},
  async execute(context: ExecutorContext, input: GitCommitExecutorInput) {
    const files = uniqueGitPaths(input.files);
    if (files.length > 0) {
      let filesToStage = files;
      if (!context.dryRun) {
        const statusOutput = await context.runtime.runCommand(["git", "status", "--porcelain", "--", ...files], {
          dryRun: false,
          verbose: context.verbose,
          label: "git status",
          printFailureOutput: false,
        });
        filesToStage = selectPathsNeedingGitStage(files, parsePorcelain(statusOutput));
      }

      if (filesToStage.length > 0) {
        await context.runtime.runCommand(["git", "add", "-A", "--", ...filesToStage], {
          dryRun: context.dryRun,
          verbose: context.verbose,
          label: "git add",
        });
      }
    }

    const commitArgs = input.editEnabled
      ? ["git", "commit", "-e", "-m", input.message]
      : ["git", "commit", "-m", input.message];
    if (files.length > 0) {
      commitArgs.push("--", ...files);
    }

    const output = await context.runtime.runCommand(commitArgs, {
      dryRun: context.dryRun,
      verbose: context.verbose,
      label: "git commit",
    });

    const match = output.match(/\[\S+ ([0-9a-f]{7,40})\]/);
    const commitHash = match?.[1] ?? null;

    return { output, commitHash };
  },
};
