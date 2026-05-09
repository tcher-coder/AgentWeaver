import type { AutoFlowSelection, ResolvedAutoFlow } from "./auto-flow-resolver.js";

export const AUTO_FLOW_STANDARD_FLOW_ID = "auto-common";
export const AUTO_FLOW_SIMPLE_FLOW_ID = "auto-simple";
export const AUTO_FLOW_CONFIG_FLOW_ID_PREFIX = "auto-config:";

const VALID_AUTO_FLOW_CONFIG_ID_RE = /^[A-Za-z0-9._-]+$/;

export type AutoFlowIdentity = {
  flowId: string;
  displayLabel: string;
  selectedCommand: "auto-common" | "auto-simple";
};

export function defaultAutoFlowSelection(): AutoFlowSelection {
  return { kind: "preset", preset: "standard" };
}

export function autoFlowIdentityForSelection(
  selection: AutoFlowSelection,
  resolved: ResolvedAutoFlow,
): AutoFlowIdentity {
  if (selection.kind === "config") {
    return {
      flowId: `${AUTO_FLOW_CONFIG_FLOW_ID_PREFIX}${resolved.config.name}`,
      displayLabel: `config ${resolved.config.name}`,
      selectedCommand: resolved.document.selectedCommand,
    };
  }

  return {
    flowId: selection.preset === "simple" ? AUTO_FLOW_SIMPLE_FLOW_ID : AUTO_FLOW_STANDARD_FLOW_ID,
    displayLabel: `${selection.preset} preset`,
    selectedCommand: selection.preset === "simple" ? AUTO_FLOW_SIMPLE_FLOW_ID : AUTO_FLOW_STANDARD_FLOW_ID,
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
  return flowId === AUTO_FLOW_STANDARD_FLOW_ID || flowId === AUTO_FLOW_SIMPLE_FLOW_ID;
}

export function isConfigurableAutoFlowId(flowId: string): boolean {
  return isConfigurableAutoPresetFlowId(flowId) || isConfigurableAutoConfigFlowId(flowId);
}

export function isRestartArchivingFlowId(flowId: string): boolean {
  return (
    flowId === AUTO_FLOW_STANDARD_FLOW_ID ||
    flowId === AUTO_FLOW_SIMPLE_FLOW_ID ||
    flowId === "auto-common-guided" ||
    flowId === "auto-golang" ||
    flowId === "instant-task" ||
    isConfigurableAutoConfigFlowId(flowId)
  );
}

export function isContinuableParentFlowId(flowId: string): boolean {
  return (
    flowId === AUTO_FLOW_STANDARD_FLOW_ID ||
    flowId === AUTO_FLOW_SIMPLE_FLOW_ID ||
    flowId === "auto-golang" ||
    flowId === "instant-task" ||
    isConfigurableAutoConfigFlowId(flowId)
  );
}
