import type { InteractiveSessionOptions } from "./session.js";
import type { GitWorkspaceSnapshot } from "../git/git-types.js";
import type { FlowStatusState, FocusPane } from "./types.js";
import type { ArtifactExplorerViewModel } from "./view-model.js";
import { buildFlowTree, collectInitiallyExpandedFolderKeys, computeVisibleFlowItems, makeFlowKey } from "./tree.js";
import { AUTO_FLOW_BASE_FLOW_ID } from "../pipeline/auto-flow-identity.js";

export type InteractiveSessionState = {
  scopeKey: string;
  jiraIssueKey: string | null;
  gitBranchName: string | null;
  summaryText: string;
  version: string;
  flowTreeKeys: string[];
  selectedFlowId: string;
  selectedFlowItemKey: string;
  focusedPane: FocusPane;
  summaryVisible: boolean;
  busy: boolean;
  currentFlowId: string | null;
  currentNode: string | null;
  currentExecutor: string | null;
  failedFlowId: string | null;
  flowState: FlowStatusState;
  runningStartedAt: number | null;
  spinnerFrame: number;
  progressScrollOffset: number;
  summaryScrollOffset: number;
  logScrollOffset: number;
  helpScrollOffset: number;
  artifactExplorer: ArtifactExplorerViewModel;
  gitWorkspace: GitWorkspaceSnapshot;
};

export function createUnavailableGitWorkspace(message = "Git workspace has not been refreshed yet."): GitWorkspaceSnapshot {
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
    refreshedAt: null,
    selectedPaths: [],
    commitMessage: "",
    operation: { status: "idle" },
  };
}

export function createInitialInteractiveState(options: InteractiveSessionOptions): InteractiveSessionState {
  const flowTree = buildFlowTree(options.flows);
  const expandedFlowFolders = new Set<string>(collectInitiallyExpandedFolderKeys(flowTree));
  const visibleFlowItems = computeVisibleFlowItems(flowTree, expandedFlowFolders);
  const visibleFlowNodes = visibleFlowItems.filter((item): item is Extract<(typeof visibleFlowItems)[number], { kind: "flow" }> => item.kind === "flow");
  const visibleAutoItem = visibleFlowNodes.find((item) => item.flow.id === AUTO_FLOW_BASE_FLOW_ID);
  const autoFlow = options.flows.find((flow) => flow.id === AUTO_FLOW_BASE_FLOW_ID);
  const preferredVisibleItem =
    visibleAutoItem
    ?? visibleFlowNodes.find((item) => item.flow.catalogRole === "recipe" || item.pathSegments[0] === "recommended")
    ?? visibleFlowNodes.find((item) => item.pathSegments[0] === "custom")
    ?? visibleFlowNodes.find((item) => item.pathSegments[0] === "built-in-blocks")
    ?? visibleFlowNodes[0];
  const selectedFlowId = autoFlow?.id ?? preferredVisibleItem?.flow.id ?? options.flows[0]?.id ?? AUTO_FLOW_BASE_FLOW_ID;
  const selectedFlowItemKey =
    (autoFlow ? visibleAutoItem?.key : preferredVisibleItem?.key)
    ?? makeFlowKey(selectedFlowId);

  return {
    scopeKey: options.scopeKey,
    jiraIssueKey: options.jiraIssueKey ?? null,
    gitBranchName: options.gitBranchName,
    summaryText: options.summaryText.trim(),
    version: options.version ?? "",
    flowTreeKeys: flowTree.map((node) => node.key),
    selectedFlowId,
    selectedFlowItemKey,
    focusedPane: "flows",
    summaryVisible: options.summaryText.trim().length > 0,
    busy: false,
    currentFlowId: null,
    currentNode: null,
    currentExecutor: null,
    failedFlowId: null,
    flowState: {
      flowId: null,
      executionState: null,
    },
    runningStartedAt: null,
    spinnerFrame: 0,
    progressScrollOffset: 0,
    summaryScrollOffset: 0,
    logScrollOffset: 0,
    helpScrollOffset: 0,
    artifactExplorer: {
      available: false,
      open: false,
      scopeKey: null,
      runId: null,
      status: "unavailable",
      label: "Artifact Explorer",
      message: "Artifacts are available after a Web UI workflow run completes.",
    },
    gitWorkspace: createUnavailableGitWorkspace(),
  };
}
