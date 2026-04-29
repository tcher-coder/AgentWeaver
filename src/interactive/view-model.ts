import type { UserInputFieldDefinition, UserInputFormDefinition, UserInputFormValues } from "../user-input.js";

export type InteractiveConfirmationAction = "resume" | "continue" | "restart" | "cancel" | "ok" | "stop";

export type InteractiveConfirmationViewModel = {
  kind: "run" | "interrupt" | "exit";
  flowId: string | null;
  text: string;
  actions: InteractiveConfirmationAction[];
  selectedAction: InteractiveConfirmationAction;
};

export type InteractiveFormViewModel = {
  title: string;
  content: string;
  footer: string;
  formId: string;
  definition: UserInputFormDefinition;
  values: UserInputFormValues;
  fields: UserInputFieldDefinition[];
  currentFieldId: string;
  error: string | null;
};

export type ArtifactExplorerStatus = "unavailable" | "completed" | "failed";

export type ArtifactExplorerViewModel = {
  available: boolean;
  open: boolean;
  scopeKey: string | null;
  runId: string | null;
  runIds?: string[];
  status: ArtifactExplorerStatus;
  label: string;
  artifactCount?: number;
  message: string;
};

export type InteractiveSessionViewModel = {
  title: string;
  header: string;
  footer: string;
  helpVisible: boolean;
  helpText: string;
  helpScrollOffset: number;
  flowListTitle: string;
  flowItems: Array<{
    key: string;
    label: string;
    kind: "folder" | "flow";
    name: string;
    depth: number;
    expanded?: boolean;
  }>;
  selectedFlowIndex: number;
  progressTitle: string;
  progressText: string;
  progressScrollOffset: number;
  descriptionText: string;
  statusText: string;
  summaryVisible: boolean;
  summaryTitle: string;
  summaryText: string;
  summaryScrollOffset: number;
  logTitle: string;
  logText: string;
  logScrollOffset: number;
  confirmText: string | null;
  confirmation: InteractiveConfirmationViewModel | null;
  form: InteractiveFormViewModel | null;
  artifactExplorer: ArtifactExplorerViewModel;
};
