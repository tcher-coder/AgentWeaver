import type { AutoFlowSelection, ResolvedAutoFlow } from "./auto-flow-resolver.js";

export const AUTO_FLOW_BASE_FLOW_ID = "auto";
export const AUTO_FLOW_CONFIG_FLOW_ID_PREFIX = "auto-config:";
export const LEGACY_AUTO_FLOW_IDS = ["auto-common", "auto-simple", "auto-golang", "auto-common-guided"] as const;
export const LEGACY_AUTO_FLOW_STATE_ERROR = "This run was created with legacy auto-* flow identity. Restart with `agentweaver auto`.";

const VALID_AUTO_FLOW_CONFIG_ID_RE = /^[A-Za-z0-9._-]+$/;

export type AutoFlowIdentity = {
  flowId: string;
  displayLabel: string;
  mutable: boolean;
};

export function defaultAutoFlowSelection(): AutoFlowSelection {
  return { kind: "base" };
}

export function autoFlowIdentityForSelection(
  selection: AutoFlowSelection,
  resolved: ResolvedAutoFlow,
): AutoFlowIdentity {
  if (selection.kind === "config") {
    return {
      flowId: `${AUTO_FLOW_CONFIG_FLOW_ID_PREFIX}${resolved.config.name}`,
      displayLabel: `config ${resolved.config.name}`,
      mutable: true,
    };
  }

  return {
    flowId: AUTO_FLOW_BASE_FLOW_ID,
    displayLabel: "Auto workflow",
    mutable: false,
  };
}

export function isConfigurableAutoConfigFlowId(flowId: string): boolean {
  if (!flowId.startsWith(AUTO_FLOW_CONFIG_FLOW_ID_PREFIX)) {
    return false;
  }
  const configName = flowId.slice(AUTO_FLOW_CONFIG_FLOW_ID_PREFIX.length);
  return VALID_AUTO_FLOW_CONFIG_ID_RE.test(configName);
}

export function isConfigurableAutoPresetFlowId(flowId: string): boolean {
  return flowId === AUTO_FLOW_BASE_FLOW_ID;
}

export function isConfigurableAutoFlowId(flowId: string): boolean {
  return isConfigurableAutoPresetFlowId(flowId) || isConfigurableAutoConfigFlowId(flowId);
}

export function isRestartArchivingFlowId(flowId: string): boolean {
  return (
    flowId === AUTO_FLOW_BASE_FLOW_ID ||
    flowId === "instant-task" ||
    isConfigurableAutoConfigFlowId(flowId)
  );
}

export function isContinuableParentFlowId(flowId: string): boolean {
  return (
    flowId === AUTO_FLOW_BASE_FLOW_ID ||
    flowId === "instant-task" ||
    isConfigurableAutoConfigFlowId(flowId)
  );
}

export function isLegacyAutoFlowId(flowId: string): boolean {
  return (LEGACY_AUTO_FLOW_IDS as readonly string[]).includes(flowId);
}
