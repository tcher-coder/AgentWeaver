import type { DeclarativeFlowSpec, DeclarativePhaseSpec } from "./spec-types.js";

export const AUTO_FLOW_SLOT_IDS = [
  "source",
  "normalize",
  "planning",
  "designReview",
  "implementation",
  "postImplementationChecks",
  "review",
  "final",
] as const;

export type AutoFlowSlotId = (typeof AUTO_FLOW_SLOT_IDS)[number];

export type AutoFlowPresetId = "simple" | "standard";

export type AutoFlowBlockCategory =
  | "source"
  | "normalize"
  | "planning"
  | "review"
  | "implementation"
  | "check"
  | "final";

export type AutoFlowContract = string;

export type AutoFlowIntegerParameterDefinition = {
  type: "integer";
  min: number;
  max: number;
  default: number;
  supportedExecutableValues: readonly number[];
};

export type AutoFlowParameterDefinition = AutoFlowIntegerParameterDefinition;

export type AutoFlowParameterValues = Record<string, unknown>;

export type AutoFlowPhaseFactoryContext = {
  blockId: string;
  slotId: AutoFlowSlotId;
  params: Readonly<AutoFlowParameterValues>;
};

export type AutoFlowBlockDefinition = {
  id: string;
  title: string;
  category: AutoFlowBlockCategory;
  allowedSlots: readonly AutoFlowSlotId[];
  requires: readonly AutoFlowContract[];
  provides: readonly AutoFlowContract[];
  params?: Readonly<Record<string, AutoFlowParameterDefinition>>;
  locked?: boolean;
  defaultEnabled?: boolean;
  createPhase: (context: AutoFlowPhaseFactoryContext) => DeclarativePhaseSpec;
};

export type AutoFlowPresetBlockPlacement = {
  blockId: string;
  slot: AutoFlowSlotId;
  locked?: boolean;
  defaultEnabled?: boolean;
  params?: AutoFlowParameterValues;
};

export type AutoFlowPreset = {
  id: AutoFlowPresetId;
  title: string;
  fileName: string;
  kind: string;
  version: number;
  description: string;
  blocks: readonly AutoFlowPresetBlockPlacement[];
};

export type AutoFlowOverrideBlockPlacement = {
  blockId: string;
  slot: AutoFlowSlotId;
  enabled?: boolean;
  params?: AutoFlowParameterValues;
};

export type AutoFlowSavedConfigOverride = {
  placements?: readonly AutoFlowOverrideBlockPlacement[];
  disabledBlocks?: readonly string[];
  blockParams?: Readonly<Record<string, AutoFlowParameterValues>>;
};

export const AUTO_FLOW_SUMMARY_STATUSES = [
  "enabled",
  "disabled",
  "skipped",
  "auto-disabled",
  "invalid",
] as const;

export type AutoFlowSummaryStatus = (typeof AUTO_FLOW_SUMMARY_STATUSES)[number];

export type AutoFlowResolvedBlockDecision = {
  status: AutoFlowSummaryStatus;
  blockId: string;
  slotId?: AutoFlowSlotId;
  reason: string;
  diagnosticCode?: AutoFlowValidationDiagnosticCode;
};

export type AutoFlowResolvedSummary = {
  presetId: AutoFlowPresetId;
  enabled: AutoFlowResolvedBlockDecision[];
  disabled: AutoFlowResolvedBlockDecision[];
  skipped: AutoFlowResolvedBlockDecision[];
  autoDisabled: AutoFlowResolvedBlockDecision[];
  invalid: AutoFlowResolvedBlockDecision[];
};

export type AutoFlowValidationDiagnosticCode =
  | "unknown-block"
  | "invalid-slot"
  | "locked-block-disabled"
  | "locked-block-removed"
  | "duplicate-block"
  | "unknown-parameter"
  | "invalid-parameter-type"
  | "parameter-out-of-range"
  | "unsupported-override"
  | "missing-dependency";

export type AutoFlowValidationDiagnostic = {
  code: AutoFlowValidationDiagnosticCode;
  message: string;
  blockId?: string;
  slotId?: AutoFlowSlotId | string;
  paramName?: string;
  value?: unknown;
  allowedSlots?: readonly AutoFlowSlotId[];
  missingContract?: AutoFlowContract;
};

export type AutoFlowResolverResult = {
  preset: AutoFlowPreset;
  summary: AutoFlowResolvedSummary;
  diagnostics: AutoFlowValidationDiagnostic[];
  spec?: DeclarativeFlowSpec;
};
