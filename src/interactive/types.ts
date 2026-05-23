import type { FlowExecutionState } from "../pipeline/spec-types.js";
import type { AutoFlowConfigLocation, SavedAutoFlowConfig } from "../pipeline/auto-flow-config.js";
import type { AutoFlowSelection } from "../pipeline/auto-flow-resolver.js";
import type { AutoFlowSlotId, AutoFlowValidationDiagnostic } from "../pipeline/auto-flow-types.js";

export type AutoFlowEditorSource =
  | {
      type: "base";
    }
  | {
      type: "project-config" | "user-config";
      configName: string;
      path: string;
      shadowedUserPath?: string;
    };

export type InteractiveAutoFlowDefinition = {
  selection: AutoFlowSelection;
  config: SavedAutoFlowConfig;
  source: AutoFlowEditorSource;
  diagnostics?: AutoFlowValidationDiagnostic[];
  lastMessage?: string;
};

export type InteractiveFlowDefinition = {
  id: string;
  label: string;
  description: string;
  source: "built-in" | "global" | "project-local";
  treePath: string[];
  sourcePath?: string;
  autoFlow?: InteractiveAutoFlowDefinition;
  phases: Array<{
    id: string;
    repeatVars: Record<string, string | number | boolean | null>;
    steps: Array<{
      id: string;
    }>;
  }>;
};

export type FocusPane = "flows" | "progress" | "summary" | "log";

export type FlowStatus = "pending" | "running" | "done" | "skipped";

export type AutoFlowProgressStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "stopped"
  | "skipped"
  | "waiting-user"
  | "disabled"
  | "blocked"
  | "invalid"
  | "empty";

export type ProgressDisplayStatus = FlowStatus | AutoFlowProgressStatus;

export type AutoFlowParameterViewModel = {
  name: string;
  label: string;
  type: "integer";
  value: number | null;
  defaultValue: number;
  min: number;
  max: number;
};

export type AutoFlowBlockActions = {
  canEnable: boolean;
  canDisable: boolean;
  canRemove: boolean;
  canEditParams: boolean;
};

export type AutoFlowBlockViewModel = {
  blockId: string;
  title: string;
  slotId: AutoFlowSlotId;
  status: AutoFlowProgressStatus;
  reason: string;
  locked: boolean;
  enabled: boolean;
  actions: AutoFlowBlockActions;
  params: AutoFlowParameterViewModel[];
  diagnostics: AutoFlowValidationDiagnostic[];
  phaseId?: string;
};

export type AutoFlowSlotViewModel = {
  slotId: AutoFlowSlotId;
  title: string;
  status: AutoFlowProgressStatus;
  reason: string;
  blocks: AutoFlowBlockViewModel[];
  diagnostics: AutoFlowValidationDiagnostic[];
};

export type AutoFlowAvailableBlockViewModel = {
  blockId: string;
  title: string;
  allowedSlots: AutoFlowSlotId[];
};

export type AutoFlowConfigStatus = {
  valid: boolean;
  canSave: boolean;
  canSaveAs: boolean;
  canReset: boolean;
  canRun: boolean;
  mutable: boolean;
  saveTarget: AutoFlowConfigLocation;
  sourceLabel: string;
  lastMessage?: string;
};

export type AutoFlowEditorViewModel = {
  selection: AutoFlowSelection;
  configName: string;
  source: AutoFlowEditorSource;
  slots: AutoFlowSlotViewModel[];
  diagnostics: AutoFlowValidationDiagnostic[];
  availableBlocks: AutoFlowAvailableBlockViewModel[];
  status: AutoFlowConfigStatus;
};

export type FlowStatusState = {
  flowId: string | null;
  executionState: FlowExecutionState | null;
};

export type FlowTreeFolderNode = {
  kind: "folder";
  key: string;
  name: string;
  pathSegments: string[];
  children: FlowTreeNode[];
};

export type FlowTreeFlowNode = {
  kind: "flow";
  key: string;
  name: string;
  pathSegments: string[];
  flow: InteractiveFlowDefinition;
};

export type FlowTreeNode = FlowTreeFolderNode | FlowTreeFlowNode;

export type VisibleFlowTreeItem =
  | {
      kind: "folder";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
    }
  | {
      kind: "flow";
      key: string;
      name: string;
      depth: number;
      pathSegments: string[];
      flow: InteractiveFlowDefinition;
    };

export type GroupedPhaseItem =
  | {
      kind: "phase";
      phase: InteractiveFlowDefinition["phases"][number];
    }
  | {
      kind: "group";
      label: string;
      phases: InteractiveFlowDefinition["phases"];
      seriesKey: string;
    };

export type ProgressViewModelItem =
  | {
      kind: "group";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "phase";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "step";
      label: string;
      depth: number;
      status: FlowStatus;
    }
  | {
      kind: "slot";
      label: string;
      depth: number;
      status: AutoFlowProgressStatus;
      detail?: string;
      slotId: AutoFlowSlotId;
    }
  | {
      kind: "block";
      label: string;
      depth: number;
      status: AutoFlowProgressStatus;
      detail?: string;
      slotId: AutoFlowSlotId;
      blockId: string;
      locked: boolean;
      enabled: boolean;
    }
  | {
      kind: "termination";
      label: string;
      detail: string;
      depth: number;
      status: "done" | "running" | "success" | "stopped" | "failed";
    };

export type ProgressViewModel = {
  flow: InteractiveFlowDefinition | null;
  items: ProgressViewModelItem[];
  anchorIndex: number | null;
};
