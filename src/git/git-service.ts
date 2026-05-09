import process from "node:process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { createSyntheticAddedDiff, parseGitDiffOutput } from "./git-diff-parser.js";
import { selectPathsNeedingGitStage, uniqueGitPaths } from "./git-stage-selection.js";
import { parsePorcelain } from "./git-status-parser.js";
import type {
  GitBranchSummary,
  GitChangedFile,
  GitCommandRunnerOptions,
  GitDiffMode,
  GitFileDiff,
  GitLastCommit,
  GitOperationFeedback,
  GitRemoteSummary,
  GitServiceOptions,
  GitValidationResult,
  GitWorkspaceSnapshot,
} from "./git-types.js";

const DEFAULT_REMOTE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_DIFF_BYTES = 1024 * 1024;
const GIT_DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--find-renames", "--unified=3"];

export type GitService = ReturnType<typeof createGitService>;

type BranchLine = {
  branch: string | null;
  detachedHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
};

export class GitDiffError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function unavailableSnapshot(message: string): GitWorkspaceSnapshot {
  return {
    available: false,
    repositoryRoot: null,
    branch: null,
    detachedHead: false,
    clean: true,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    changedFiles: [],
    branches: [],
    remotes: [],
    canPush: false,
    pushDisabledReason: "Git repository is not available.",
    warnings: [],
    error: message,
    refreshedAt: new Date().toISOString(),
    selectedPaths: [],
    commitMessage: "",
    operation: { status: "idle" },
  };
}

function success(message: string, commitHash?: string | null): GitOperationFeedback {
  return { status: "success", message, ...(commitHash !== undefined ? { commitHash } : {}) };
}

function errorMessage(error: unknown): string {
  const err = error as Error & { output?: string };
  const output = typeof err.output === "string" ? err.output.trim() : "";
  return output || err.message || "Git operation failed.";
}

function parseBranchLine(output: string): BranchLine {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith("## ")) ?? "";
  const raw = line.slice(3).trim();
  if (!raw) {
    return { branch: null, detachedHead: false, upstream: null, ahead: 0, behind: 0 };
  }
  if (raw === "HEAD (no branch)" || raw.includes("no branch")) {
    return { branch: null, detachedHead: true, upstream: null, ahead: 0, behind: 0 };
  }

  const ahead = Number(raw.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(raw.match(/behind (\d+)/)?.[1] ?? 0);
  const base = raw.split(" [")[0] ?? raw;
  const [branchPart, upstreamPart] = base.split("...");
  const branch = branchPart?.replace(/^No commits yet on /, "").trim() || null;
  const upstream = upstreamPart?.trim() || null;
  return { branch, detachedHead: false, upstream, ahead, behind };
}

function parseLastCommit(output: string): GitLastCommit | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const [hash, shortHash, subject, authoredAt] = trimmed.split("\0");
  if (!hash || !shortHash) {
    return null;
  }
  return {
    hash,
    shortHash,
    subject: subject ?? "",
    authoredAt: authoredAt ?? "",
  };
}

function parseBranches(output: string): GitBranchSummary[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name, head, upstream] = line.split("\0");
      return {
        name: name ?? "",
        current: head === "*",
        ...(upstream ? { upstream } : {}),
      };
    })
    .filter((branch) => branch.name.length > 0);
}

function parseRemotes(output: string): GitRemoteSummary[] {
  const remotes = new Map<string, GitRemoteSummary>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(.+)\s+\((fetch|push)\)$/);
    if (!match) {
      continue;
    }
    const [, name, url, kind] = match;
    const current = remotes.get(name!) ?? { name: name! };
    if (kind === "fetch") {
      current.fetchUrl = url!;
    } else {
      current.pushUrl = url!;
    }
    remotes.set(name!, current);
  }
  return Array.from(remotes.values());
}

function nonInteractiveEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
    SSH_ASKPASS: "echo",
    GCM_INTERACTIVE: "Never",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  };
}

function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

function validateLocalBranchName(name: string): GitValidationResult {
  if (name.trim().length === 0) {
    return { ok: false, message: "Branch name must not be empty." };
  }
  if (name !== name.trim()) {
    return { ok: false, message: "Branch name must not include leading or trailing whitespace." };
  }
  if (name.startsWith("-")) {
    return { ok: false, message: "Branch name must not start with a dash." };
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    return { ok: false, message: "Branch name must not contain control characters." };
  }
  if (name.split("/").some((segment) => segment === "." || segment === "..")) {
    return { ok: false, message: "Branch name must not contain path traversal segments." };
  }
  return { ok: true };
}

function validateCommitMessage(message: string): GitValidationResult {
  if (message.trim().length === 0) {
    return { ok: false, message: "Commit message must not be empty." };
  }
  return { ok: true };
}

function validateChangedPaths(paths: string[], snapshot: GitWorkspaceSnapshot): GitValidationResult {
  if (!Array.isArray(paths) || paths.some((item) => typeof item !== "string" || item.length === 0)) {
    return { ok: false, message: "Git file paths must be non-empty strings." };
  }
  const changed = new Set(snapshot.changedFiles.flatMap((file) => [file.path, file.file]));
  for (const filePath of paths) {
    if (!changed.has(filePath)) {
      return { ok: false, message: `Path is not in the current Git snapshot: ${filePath}` };
    }
  }
  return { ok: true };
}

function findChangedFile(filePath: string, snapshot: GitWorkspaceSnapshot): GitChangedFile | null {
  return snapshot.changedFiles.find((file) => file.path === filePath || file.file === filePath) ?? null;
}

function validateChangedPath(filePath: string, snapshot: GitWorkspaceSnapshot): GitChangedFile {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    throw new GitDiffError("invalid_path", "Git file path must be a non-empty string.");
  }
  if (!snapshot.available || !snapshot.repositoryRoot) {
    throw new GitDiffError("repository_unavailable", snapshot.error ?? "Git repository is not available.");
  }
  const file = findChangedFile(filePath, snapshot);
  if (!file) {
    throw new GitDiffError("invalid_path", `Path is not in the current Git snapshot: ${filePath}`);
  }
  return file;
}

function isInsideDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function emptyDiff(mode: GitDiffMode, file: GitChangedFile, message: string): GitFileDiff {
  return {
    mode,
    path: file.path,
    displayPath: file.path,
    ...(file.originalPath || file.originalFile ? { originalPath: file.originalPath ?? file.originalFile } : {}),
    binary: false,
    tooLarge: false,
    empty: true,
    hunks: [],
    message,
  };
}

function tooLargeDiff(mode: GitDiffMode, file: GitChangedFile, message: string): GitFileDiff {
  return {
    mode,
    path: file.path,
    displayPath: file.path,
    ...(file.originalPath || file.originalFile ? { originalPath: file.originalPath ?? file.originalFile } : {}),
    binary: false,
    tooLarge: true,
    empty: false,
    hunks: [],
    message,
  };
}

function binaryDiff(mode: GitDiffMode, file: GitChangedFile, message: string): GitFileDiff {
  return {
    mode,
    path: file.path,
    displayPath: file.path,
    ...(file.originalPath || file.originalFile ? { originalPath: file.originalPath ?? file.originalFile } : {}),
    binary: true,
    tooLarge: false,
    empty: false,
    hunks: [],
    message,
  };
}

function extractCommitHash(output: string): string | null {
  return output.match(/\[\S+ ([0-9a-f]{7,40})\]/)?.[1] ?? null;
}

export function createGitService(options: GitServiceOptions) {
  const cwdPrefix = options.cwd ? ["-C", options.cwd] : [];
  const remoteTimeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const maxDiffBytes = options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;

  async function git(args: string[], commandOptions: GitCommandRunnerOptions = {}): Promise<string> {
    return options.runCommand(["git", ...cwdPrefix, ...args], {
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
      ...commandOptions,
    });
  }

  async function remoteGit(args: string[], label: string): Promise<string> {
    return withTimeout(remoteTimeoutMs, (signal) => git(args, {
      label,
      env: nonInteractiveEnv(),
      signal,
      printFailureOutput: false,
    }));
  }

  async function validateBranchName(name: string): Promise<GitValidationResult> {
    const local = validateLocalBranchName(name);
    if (!local.ok) {
      return local;
    }
    try {
      await git(["check-ref-format", "--branch", name], {
        label: "git check-ref-format",
        printFailureOutput: false,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  async function status(): Promise<GitWorkspaceSnapshot> {
    try {
      const repositoryRoot = (await git(["rev-parse", "--show-toplevel"], {
        label: "git rev-parse",
        printFailureOutput: false,
      })).trim();
      const statusOutput = await git(["status", "--porcelain", "--branch"], {
        label: "git status",
        printFailureOutput: false,
      });
      const changedFiles = parsePorcelain(statusOutput);
      const branch = parseBranchLine(statusOutput);

      let branches: GitBranchSummary[] = [];
      let remotes: GitRemoteSummary[] = [];
      let lastCommit: GitLastCommit | null = null;
      const warnings: string[] = [];
      try {
        branches = parseBranches(await git(["branch", "--format=%(refname:short)%00%(HEAD)%00%(upstream:short)"], {
          label: "git branch",
          printFailureOutput: false,
        }));
      } catch (error) {
        warnings.push(`Branches could not be listed: ${errorMessage(error)}`);
      }
      try {
        remotes = parseRemotes(await git(["remote", "-v"], {
          label: "git remote",
          printFailureOutput: false,
        }));
      } catch (error) {
        warnings.push(`Remotes could not be listed: ${errorMessage(error)}`);
      }
      try {
        lastCommit = parseLastCommit(await git(["log", "-1", "--format=%H%x00%h%x00%s%x00%ci"], {
          label: "git log",
          printFailureOutput: false,
        }));
      } catch {
        lastCommit = null;
      }

      const hasRemotes = remotes.length > 0;
      const canPush = hasRemotes && !branch.detachedHead && Boolean(branch.branch);
      const pushDisabledReason = canPush
        ? null
        : !hasRemotes
          ? "No Git remote is configured."
          : branch.detachedHead
            ? "Detached HEAD cannot be pushed."
            : "No current branch is available to push.";

      return {
        available: true,
        repositoryRoot,
        branch: branch.branch,
        detachedHead: branch.detachedHead,
        clean: changedFiles.length === 0,
        upstream: branch.upstream,
        ahead: branch.ahead,
        behind: branch.behind,
        lastCommit,
        changedFiles,
        branches,
        remotes,
        canPush,
        pushDisabledReason,
        warnings,
        error: null,
        refreshedAt: new Date().toISOString(),
        selectedPaths: [],
        commitMessage: "",
        operation: { status: "idle" },
      };
    } catch (error) {
      return unavailableSnapshot(errorMessage(error));
    }
  }

  async function diffFile(filePath: string, mode: GitDiffMode, snapshot: GitWorkspaceSnapshot): Promise<GitFileDiff> {
    if (!["head", "staged", "worktree"].includes(mode)) {
      throw new GitDiffError("invalid_mode", "Git diff mode must be head, staged, or worktree.");
    }
    const file = validateChangedPath(filePath, snapshot);
    if ((file.type === "untracked" || file.xy === "??") && mode !== "staged") {
      return readUntrackedDiff(file, mode, snapshot);
    }
    if ((file.type === "untracked" || file.xy === "??") && mode === "staged") {
      return emptyDiff(mode, file, "Untracked file has no staged diff.");
    }

    const args = diffArgs(mode, file.path);
    let output: string;
    try {
      output = await git(args, { label: "git diff", printFailureOutput: false });
    } catch (error) {
      throw new GitDiffError("git_failed", errorMessage(error));
    }
    if (Buffer.byteLength(output, "utf8") > maxDiffBytes) {
      return tooLargeDiff(mode, file, "Diff is too large to display.");
    }
    return parseGitDiffOutput(output, {
      mode,
      path: file.path,
      displayPath: file.path,
      ...(file.originalPath || file.originalFile ? { originalPath: file.originalPath ?? file.originalFile } : {}),
    });
  }

  function diffArgs(mode: GitDiffMode, filePath: string): string[] {
    if (mode === "head") {
      return ["diff", ...GIT_DIFF_FLAGS, "HEAD", "--", filePath];
    }
    if (mode === "staged") {
      return ["diff", ...GIT_DIFF_FLAGS, "--cached", "--", filePath];
    }
    return ["diff", ...GIT_DIFF_FLAGS, "--", filePath];
  }

  function readUntrackedDiff(file: GitChangedFile, mode: GitDiffMode, snapshot: GitWorkspaceSnapshot): GitFileDiff {
    const repositoryRoot = snapshot.repositoryRoot;
    if (!repositoryRoot) {
      throw new GitDiffError("repository_unavailable", "Git repository is not available.");
    }
    const rootRealPath = realpathSync(repositoryRoot);
    const candidatePath = path.resolve(repositoryRoot, file.path);
    let realPath: string;
    try {
      realPath = realpathSync(candidatePath);
    } catch {
      throw new GitDiffError("read_failed", "Untracked file could not be read.");
    }
    if (!isInsideDirectory(rootRealPath, realPath)) {
      throw new GitDiffError("forbidden_path", "Untracked file path escapes the repository root.");
    }
    const stats = statSync(realPath);
    if (!stats.isFile()) {
      throw new GitDiffError("forbidden_path", "Untracked path is not a regular file.");
    }
    if (stats.size > maxDiffBytes) {
      return tooLargeDiff(mode, file, "Untracked file is too large to display.");
    }
    const content = readFileSync(realPath);
    if (isBinaryBuffer(content)) {
      return binaryDiff(mode, file, "Binary untracked file diff is not displayed.");
    }
    return createSyntheticAddedDiff({
      mode,
      path: file.path,
      displayPath: file.path,
      content: content.toString("utf8"),
    });
  }

  async function createBranch(branchName: string): Promise<GitOperationFeedback> {
    const validation = await validateBranchName(branchName);
    if (!validation.ok) {
      return { status: "error", message: validation.message ?? "Branch name is invalid." };
    }
    try {
      await git(["checkout", "-b", branchName], { label: "git checkout -b", printFailureOutput: false });
      return success(`Created branch ${branchName}.`);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function checkout(branchName: string): Promise<GitOperationFeedback> {
    const validation = await validateBranchName(branchName);
    if (!validation.ok) {
      return { status: "error", message: validation.message ?? "Branch name is invalid." };
    }
    try {
      await git(["checkout", branchName], { label: "git checkout", printFailureOutput: false });
      return success(`Checked out ${branchName}.`);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function stage(paths: string[], snapshot: GitWorkspaceSnapshot): Promise<GitOperationFeedback> {
    const validation = validateChangedPaths(paths, snapshot);
    if (!validation.ok) {
      return { status: "error", message: validation.message ?? "Selected paths are invalid." };
    }
    const stagePaths = selectPathsNeedingGitStage(paths, snapshot.changedFiles);
    if (stagePaths.length === 0) {
      return success("Selected files are already staged.");
    }
    try {
      await git(["add", "-A", "--", ...stagePaths], { label: "git add", printFailureOutput: false });
      return success(`Staged ${stagePaths.length} file${stagePaths.length === 1 ? "" : "s"}.`);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function unstage(paths: string[], snapshot: GitWorkspaceSnapshot): Promise<GitOperationFeedback> {
    const validation = validateChangedPaths(paths, snapshot);
    if (!validation.ok) {
      return { status: "error", message: validation.message ?? "Selected paths are invalid." };
    }
    try {
      await git(["restore", "--staged", "--", ...paths], { label: "git restore --staged", printFailureOutput: false });
      return success(`Unstaged ${paths.length} file${paths.length === 1 ? "" : "s"}.`);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function commit(paths: string[], message: string, snapshot: GitWorkspaceSnapshot): Promise<GitOperationFeedback> {
    const messageValidation = validateCommitMessage(message);
    if (!messageValidation.ok) {
      return { status: "error", message: messageValidation.message ?? "Commit message is invalid." };
    }
    if (paths.length > 0) {
      const pathValidation = validateChangedPaths(paths, snapshot);
      if (!pathValidation.ok) {
        return { status: "error", message: pathValidation.message ?? "Selected paths are invalid." };
      }
    }
    const commitPaths = uniqueGitPaths(paths);
    try {
      if (commitPaths.length > 0) {
        const stagePaths = selectPathsNeedingGitStage(commitPaths, snapshot.changedFiles);
        if (stagePaths.length > 0) {
          await git(["add", "-A", "--", ...stagePaths], { label: "git add", printFailureOutput: false });
        }
      }
      const commitArgs = commitPaths.length > 0
        ? ["commit", "-m", message, "--", ...commitPaths]
        : ["commit", "-m", message];
      const output = await git(commitArgs, { label: "git commit", printFailureOutput: false });
      const commitHash = extractCommitHash(output);
      return success(commitHash ? `Committed ${commitHash}.` : "Commit completed.", commitHash);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function fetch(): Promise<GitOperationFeedback> {
    try {
      await remoteGit(["fetch", "--prune"], "git fetch");
      return success("Fetch completed.");
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function pullFfOnly(): Promise<GitOperationFeedback> {
    try {
      await remoteGit(["pull", "--ff-only"], "git pull --ff-only");
      return success("Fast-forward pull completed.");
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  async function push(snapshot: GitWorkspaceSnapshot): Promise<GitOperationFeedback> {
    if (!snapshot.canPush) {
      return { status: "error", message: snapshot.pushDisabledReason ?? "Push is not available." };
    }
    const branchName = snapshot.branch;
    if (!branchName) {
      return { status: "error", message: "No current branch is available to push." };
    }
    try {
      if (snapshot.upstream) {
        await remoteGit(["push"], "git push");
      } else {
        const remoteName = snapshot.remotes.some((remote) => remote.name === "origin")
          ? "origin"
          : snapshot.remotes[0]?.name;
        if (!remoteName) {
          return { status: "error", message: "No Git remote is configured." };
        }
        await remoteGit(["push", "--set-upstream", remoteName, branchName], "git push --set-upstream");
      }
      return success("Push completed.");
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  return {
    status,
    validateBranchName,
    diffFile,
    createBranch,
    checkout,
    stage,
    unstage,
    commit,
    fetch,
    pullFfOnly,
    push,
  };
}

export type { GitChangedFile, GitWorkspaceSnapshot };
