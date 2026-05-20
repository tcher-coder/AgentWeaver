import crypto from "node:crypto";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { ensureScopeWorkspaceDir, jiraTaskFile } from "./artifacts.js";
import { TaskRunnerError } from "./errors.js";
import { buildJiraApiUrl, buildJiraBrowseUrl, extractIssueKey } from "./jira.js";
import {
  isUploadedTextFileValue,
  normalizeTextFileContent,
  validateUserInputValues,
  type UserInputFormDefinition,
  type UserInputRequester,
} from "./user-input.js";

export type ResolvedScope = {
  scopeType: "project";
  scopeKey: string;
  gitBranchName: string | null;
  worktreeHash: string;
  projectRoot: string;
  jiraRef?: string;
  jiraIssueKey?: string;
  jiraBrowseUrl?: string;
  jiraApiUrl?: string;
  jiraTaskFile?: string;
};

export type RequestedJiraContext = {
  jiraRef: string;
  jiraIssueKey: string;
  jiraBrowseUrl: string;
  jiraApiUrl: string;
};

export type RequestedTaskSourceContext = {
  jiraContext: RequestedJiraContext | null;
  manualTaskDescription: string | null;
};

function gitOutput(args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function shortHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 8);
}

export function sanitizeScopeName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._@-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
  if (!normalized) {
    throw new TaskRunnerError("Scope name is empty after sanitization. Use letters, digits, '.', '_', '-' or '@'.");
  }
  return normalized;
}

export function detectGitBranchName(): string | null {
  const branchName = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branchName || branchName === "HEAD") {
    return null;
  }
  return branchName;
}

export function detectProjectRoot(): string {
  return gitOutput(["rev-parse", "--show-toplevel"]) ?? process.cwd();
}

export function buildProjectScopeKey(explicitScope?: string | null, jiraIssueKey?: string | null): {
  scopeKey: string;
  gitBranchName: string | null;
  worktreeHash: string;
  projectRoot: string;
} {
  const projectRoot = detectProjectRoot();
  const worktreeHash = shortHash(projectRoot);
  if (explicitScope?.trim()) {
    return {
      scopeKey: sanitizeScopeName(explicitScope),
      gitBranchName: detectGitBranchName(),
      worktreeHash,
      projectRoot,
    };
  }
  if (jiraIssueKey?.trim()) {
    return {
      scopeKey: `${sanitizeScopeName(jiraIssueKey)}@${worktreeHash}`,
      gitBranchName: detectGitBranchName(),
      worktreeHash,
      projectRoot,
    };
  }

  const branchName = detectGitBranchName();
  const branchSlug = sanitizeScopeName(branchName ?? "detached-head");
  return {
    scopeKey: `${branchSlug}@${worktreeHash}`,
    gitBranchName: branchName,
    worktreeHash,
    projectRoot,
  };
}

export function parseJiraContext(jiraRef: string): RequestedJiraContext {
  return {
    jiraRef,
    jiraIssueKey: extractIssueKey(jiraRef),
    jiraBrowseUrl: buildJiraBrowseUrl(jiraRef),
    jiraApiUrl: buildJiraApiUrl(jiraRef),
  };
}

export function resolveProjectScope(explicitScope?: string | null, jiraRef?: string | null): ResolvedScope {
  const jiraIssueKey = jiraRef?.trim() ? extractIssueKey(jiraRef) : undefined;
  const { scopeKey, gitBranchName, worktreeHash, projectRoot } = buildProjectScopeKey(explicitScope, jiraIssueKey);
  ensureScopeWorkspaceDir(scopeKey);
  const baseScope: ResolvedScope = {
    scopeType: "project",
    scopeKey,
    gitBranchName,
    worktreeHash,
    projectRoot,
  };
  if (!jiraRef?.trim()) {
    return baseScope;
  }
  const jiraContext = parseJiraContext(jiraRef);
  return {
    ...baseScope,
    ...jiraContext,
    jiraTaskFile: jiraTaskFile(scopeKey),
  };
}

export function attachJiraContext(scope: ResolvedScope, jiraRef: string): ResolvedScope {
  const jiraContext = parseJiraContext(jiraRef);
  ensureScopeWorkspaceDir(scope.scopeKey);
  return {
    ...scope,
    ...jiraContext,
    jiraTaskFile: jiraTaskFile(scope.scopeKey),
  };
}

export function buildJiraTaskInputForm(options: { required?: boolean } = {}): UserInputFormDefinition {
  const required = options.required ?? true;
  return {
    formId: "jira-task-input",
    title: "Jira Task",
    description: required
      ? "Provide a Jira issue key or browse URL for a task-driven flow."
      : "Provide a Jira issue key or browse URL, upload a task source file, or paste the task description manually.",
    submitLabel: "Continue",
    fields: [
      {
        id: "jira_ref",
        type: "text",
        label: "Jira issue key or browse URL",
        help: required
          ? "Example: DEMO-3288 or https://jira.example.com/browse/DEMO-3288"
          : "Leave empty and upload a task source file or fill Task description below when Jira is unavailable.",
        required,
      },
      ...(!required
        ? [
            {
              id: "task_file",
              type: "text-file" as const,
              label: "Task source file",
              help: "Upload one UTF-8 .md, .markdown, .txt, or .xml file up to 512 KiB. Leave empty when using Jira or manual description.",
              required: false,
              accept: [".md", ".markdown", ".txt", ".xml", "text/plain", "text/markdown", "text/xml", "application/xml"],
              maxBytes: 512 * 1024,
              buttonLabel: "Upload file",
            },
          ]
        : []),
      ...(!required
        ? [
            {
              id: "task_description",
              type: "text" as const,
              label: "Task description",
              help: "If Jira is unavailable, paste the task title, description, acceptance criteria, comments, and links here.",
              required: false,
              multiline: true,
              rows: 10,
              placeholder: "Paste Jira task title, description, acceptance criteria, comments, and links here.",
            },
          ]
        : []),
    ],
  };
}

export async function requestJiraContext(requestUserInput: UserInputRequester): Promise<RequestedJiraContext> {
  const form = buildJiraTaskInputForm();
  const result = await requestUserInput(form);
  validateUserInputValues(form, result.values);
  const jiraRef = String(result.values.jira_ref ?? "").trim();
  if (!jiraRef) {
    throw new TaskRunnerError("Jira issue key or browse URL is required.");
  }
  return parseJiraContext(jiraRef);
}

export async function requestTaskSourceContext(
  requestUserInput: UserInputRequester,
): Promise<RequestedTaskSourceContext> {
  const form = buildJiraTaskInputForm({ required: false });
  const result = await requestUserInput(form);
  validateUserInputValues(form, result.values);
  const jiraRef = String(result.values.jira_ref ?? "").trim();
  const taskFile = isUploadedTextFileValue(result.values.task_file) ? result.values.task_file : null;
  const taskFileContent = taskFile?.content;
  if (taskFile && typeof taskFileContent !== "string") {
    throw new TaskRunnerError("Uploaded task file content is missing.");
  }
  const fileTaskDescription = taskFileContent ? normalizeTextFileContent(taskFileContent).trim() : "";
  const manualTaskDescription = fileTaskDescription || String(result.values.task_description ?? "").trim();
  return {
    jiraContext: jiraRef ? parseJiraContext(jiraRef) : null,
    manualTaskDescription: jiraRef ? null : manualTaskDescription,
  };
}
