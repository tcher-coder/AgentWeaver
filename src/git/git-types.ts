export type GitChangedFileType = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export type GitChangedFile = {
  xy: string;
  indexStatus: string;
  workTreeStatus: string;
  file: string;
  originalFile?: string;
  path: string;
  originalPath?: string;
  staged: boolean;
  type: GitChangedFileType;
};

export type GitBranchSummary = {
  name: string;
  current: boolean;
  upstream?: string;
};

export type GitRemoteSummary = {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
};

export type GitLastCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  authoredAt: string;
};

export type GitOperationStatus = "idle" | "running" | "success" | "error";

export type GitOperationFeedback = {
  status: GitOperationStatus;
  action?: string;
  message?: string;
  commitHash?: string | null;
};

export type GitWorkspaceSnapshot = {
  available: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  detachedHead: boolean;
  clean: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommit: GitLastCommit | null;
  changedFiles: GitChangedFile[];
  branches: GitBranchSummary[];
  remotes: GitRemoteSummary[];
  canPush: boolean;
  pushDisabledReason: string | null;
  warnings: string[];
  error: string | null;
  refreshedAt: string | null;
  selectedPaths: string[];
  commitMessage: string;
  operation: GitOperationFeedback;
};

export type GitCommandRunnerOptions = {
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  verbose?: boolean;
  label?: string;
  printFailureOutput?: boolean;
  stdin?: string;
  signal?: AbortSignal;
};

export type GitCommandRunner = (argv: string[], options?: GitCommandRunnerOptions) => Promise<string>;

export type GitServiceOptions = {
  cwd?: string;
  dryRun?: boolean;
  verbose?: boolean;
  timeoutMs?: number;
  runCommand: GitCommandRunner;
};

export type GitValidationResult = {
  ok: boolean;
  message?: string;
};

