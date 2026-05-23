import path from "node:path";

import { TaskRunnerError } from "../errors.js";
import { collectFlowRoutingGroups, type DeclarativeFlowLoadOptions, type DeclarativeFlowRef, loadDeclarativeFlow, type LoadedDeclarativeFlow } from "./declarative-flows.js";
import type { ExecutionRoutingGroup } from "./execution-routing-config.js";
import { globalFlowSpecsDir, listBuiltInFlowSpecFiles, listGlobalFlowSpecFiles, listProjectFlowSpecFiles, projectFlowSpecsDir } from "./spec-loader.js";
import { listAutoFlowConfigs, loadAutoFlowConfigByName } from "./auto-flow-config.js";
import { resolveAutoFlow } from "./auto-flow-resolver.js";
import { AUTO_FLOW_BASE_FLOW_ID, AUTO_FLOW_CONFIG_FLOW_ID_PREFIX } from "./auto-flow-identity.js";

export type FlowCatalogSource = "built-in" | "global" | "project-local";

export type FlowCatalogEntry = {
  id: string;
  source: FlowCatalogSource;
  fileName: string;
  absolutePath: string;
  treePath: string[];
  flow: LoadedDeclarativeFlow;
};

export const BUILT_IN_COMMAND_FLOW_IDS = [
  "auto",
  "bug-analyze",
  "bug-fix",
  "design-review",
  "git-commit",
  "gitlab-diff-review",
  "gitlab-review",
  "instant-task",
  "mr-description",
  "plan",
  "plan-revise",
  "playbook-init",
  "task-describe",
  "implement",
  "review",
  "review-fix",
  "review-loop",
  "run-go-tests-loop",
  "run-go-linter-loop",
] as const;

const BUILT_IN_COMMAND_FLOW_FILES: Partial<Record<(typeof BUILT_IN_COMMAND_FLOW_IDS)[number], string>> = {
  "bug-analyze": "bugz/bug-analyze.json",
  "bug-fix": "bugz/bug-fix.json",
  "design-review": "design-review.json",
  "git-commit": "git-commit.json",
  "gitlab-diff-review": "gitlab/gitlab-diff-review.json",
  "gitlab-review": "gitlab/gitlab-review.json",
  "instant-task": "instant-task.json",
  "mr-description": "gitlab/mr-description.json",
  plan: "plan.json",
  "plan-revise": "plan-revise.json",
  "playbook-init": "playbook-init.json",
  "task-describe": "task-describe.json",
  implement: "implement.json",
  review: "review/review.json",
  "review-fix": "review/review-fix.json",
  "review-loop": "review/review-loop.json",
  "run-go-tests-loop": "go/run-go-tests-loop.json",
  "run-go-linter-loop": "go/run-go-linter-loop.json",
};

export function builtInCommandFlowFile(flowId: string): string | null {
  return BUILT_IN_COMMAND_FLOW_FILES[flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number]] ?? null;
}

function builtInCommandIdForFile(fileName: string): (typeof BUILT_IN_COMMAND_FLOW_IDS)[number] | null {
  for (const [flowId, candidate] of Object.entries(BUILT_IN_COMMAND_FLOW_FILES)) {
    if (candidate === fileName) {
      return flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number];
    }
  }
  return null;
}

async function loadBuiltInCatalogEntry(fileName: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const commandId = builtInCommandIdForFile(fileName);
  const relativePath = fileName.replace(/\.json$/i, "").split(/[\\/]+/).filter((segment) => segment.length > 0);
  const id = commandId ?? relativePath.join("/");
  const flow = await loadDeclarativeFlow({ source: "built-in", fileName }, options);
  return {
    id,
    source: "built-in",
    fileName,
    absolutePath: flow.absolutePath,
    treePath: ["default", ...relativePath],
    flow,
  };
}

async function loadBaseAutoCatalogEntry(cwd: string): Promise<FlowCatalogEntry> {
  const resolved = await resolveAutoFlow({ kind: "base" }, { cwd });
  return {
    id: AUTO_FLOW_BASE_FLOW_ID,
    source: "built-in",
    fileName: resolved.execution.flow.fileName,
    absolutePath: resolved.execution.flow.absolutePath,
    treePath: ["recommended", "auto"],
    flow: resolved.execution.flow,
  };
}

async function loadAutoConfigCatalogEntries(cwd: string): Promise<FlowCatalogEntry[]> {
  const entries: FlowCatalogEntry[] = [];
  for (const item of listAutoFlowConfigs(cwd)) {
    const loaded = loadAutoFlowConfigByName(item.name, cwd);
    const resolved = await resolveAutoFlow({ kind: "config", name: loaded.config.name }, { cwd });
    entries.push({
      id: `${AUTO_FLOW_CONFIG_FLOW_ID_PREFIX}${loaded.config.name}`,
      source: "built-in",
      fileName: resolved.execution.flow.fileName,
      absolutePath: resolved.execution.flow.absolutePath,
      treePath: ["custom", loaded.config.name],
      flow: resolved.execution.flow,
    });
  }
  return entries;
}

async function loadProjectCatalogEntry(cwd: string, filePath: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const flow = await loadDeclarativeFlow({ source: "project-local", filePath }, { ...options, cwd });
  const relativeFilePath = path.relative(projectFlowSpecsDir(cwd), path.resolve(filePath));
  const relativePathWithoutExt = relativeFilePath.replace(/\.json$/i, "");
  const relativeSegments = relativePathWithoutExt.split(path.sep).filter((segment) => segment.length > 0);
  return {
    id: relativeSegments.join("/"),
    source: "project-local",
    fileName: path.basename(filePath),
    absolutePath: path.resolve(filePath),
    treePath: ["custom", ...relativeSegments],
    flow,
  };
}

async function loadGlobalCatalogEntry(filePath: string, options: DeclarativeFlowLoadOptions): Promise<FlowCatalogEntry> {
  const flow = await loadDeclarativeFlow({ source: "global", filePath }, options);
  const relativeFilePath = path.relative(globalFlowSpecsDir(), path.resolve(filePath));
  const relativePathWithoutExt = relativeFilePath.replace(/\.json$/i, "");
  const relativeSegments = relativePathWithoutExt.split(path.sep).filter((segment) => segment.length > 0);
  return {
    id: relativeSegments.join("/"),
    source: "global",
    fileName: path.basename(filePath),
    absolutePath: path.resolve(filePath),
    treePath: ["global", ...relativeSegments],
    flow,
  };
}

export async function loadInteractiveFlowCatalog(cwd: string, options: DeclarativeFlowLoadOptions = {}): Promise<FlowCatalogEntry[]> {
  const entries: FlowCatalogEntry[] = [await loadBaseAutoCatalogEntry(cwd)];
  entries.push(...await loadAutoConfigCatalogEntries(cwd));
  for (const fileName of listBuiltInFlowSpecFiles()) {
    if (fileName === "auto-golang.json" || fileName === "auto-common-guided.json") {
      continue;
    }
    entries.push(await loadBuiltInCatalogEntry(fileName, { ...options, cwd }));
  }
  for (const filePath of listGlobalFlowSpecFiles()) {
    entries.push(await loadGlobalCatalogEntry(filePath, { ...options, cwd }));
  }
  for (const filePath of listProjectFlowSpecFiles(cwd)) {
    entries.push(await loadProjectCatalogEntry(cwd, filePath, { ...options, cwd }));
  }

  const visibleEntries = entries.filter((entry) => entry.flow.catalogVisibility !== "hidden");

  const byId = new Map<string, FlowCatalogEntry>();
  for (const entry of visibleEntries) {
    const duplicate = byId.get(entry.id);
    if (duplicate) {
      throw new TaskRunnerError(
        `Flow id '${entry.id}' conflicts between ${duplicate.absolutePath} and ${entry.absolutePath}. Rename one of the flow files.`,
      );
    }
    byId.set(entry.id, entry);
  }
  return visibleEntries;
}

export function findCatalogEntry(flowId: string, entries: FlowCatalogEntry[]): FlowCatalogEntry | undefined {
  return entries.find((entry) => entry.id === flowId);
}

export function isBuiltInCommandFlowId(flowId: string): boolean {
  return BUILT_IN_COMMAND_FLOW_IDS.includes(flowId as (typeof BUILT_IN_COMMAND_FLOW_IDS)[number]);
}

export function toDeclarativeFlowRef(entry: FlowCatalogEntry): DeclarativeFlowRef {
  if (entry.id === AUTO_FLOW_BASE_FLOW_ID || entry.id.startsWith(AUTO_FLOW_CONFIG_FLOW_ID_PREFIX)) {
    return { source: "built-in", fileName: entry.fileName };
  }
  return entry.source === "built-in"
    ? { source: "built-in", fileName: entry.fileName }
    : { source: entry.source, filePath: entry.absolutePath };
}

export function flowRoutingKey(entry: FlowCatalogEntry): string {
  return entry.source === "built-in"
    ? `built-in:${entry.id}`
    : `${entry.source}:${entry.absolutePath}`;
}

export async function flowRoutingGroups(
  entry: FlowCatalogEntry,
  cwd: string,
  options: DeclarativeFlowLoadOptions = {},
): Promise<ExecutionRoutingGroup[]> {
  return collectFlowRoutingGroups(entry.flow, cwd, new Set<string>(), options);
}
