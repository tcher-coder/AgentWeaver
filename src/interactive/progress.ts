import type { FlowExecutionState } from "../pipeline/spec-types.js";
import { buildAutoFlowEditorViewModel } from "./auto-flow.js";
import type {
  AutoFlowBlockViewModel,
  AutoFlowProgressStatus,
  AutoFlowSlotViewModel,
  FlowStatus,
  GroupedPhaseItem,
  InteractiveFlowDefinition,
  ProgressDisplayStatus,
  ProgressViewModel,
  ProgressViewModelItem,
} from "./types.js";

export function displayPhaseId(phase: InteractiveFlowDefinition["phases"][number]): string {
  let result = phase.id;
  const values = Object.entries(phase.repeatVars)
    .filter(([key]) => !key.endsWith("_minus_one"))
    .map(([, value]) => value);
  for (const value of values) {
    const suffix = `_${String(value)}`;
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
    }
  }
  return result;
}

function repeatGroupKey(repeatVars: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(repeatVars).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function repeatSeriesKey(phases: InteractiveFlowDefinition["phases"]): string {
  const repeatVarNames = Object.keys(phases[0]?.repeatVars ?? {}).sort();
  const phaseNames = phases.map((phase) => displayPhaseId(phase));
  return JSON.stringify({
    repeatVarNames,
    phaseNames,
  });
}

function repeatLabel(repeatVars: Record<string, string | number | boolean | null>): string | null {
  const entries = Object.entries(repeatVars).filter(([key]) => !key.endsWith("_minus_one"));
  if (entries.length === 0) {
    return null;
  }
  if (entries.length === 1) {
    const [key, value] = entries[0] ?? ["repeat", ""];
    return `${key} ${value}`;
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function isAfterTermination(
  flowState: FlowExecutionState,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
): boolean {
  const terminationReason = flowState.terminationReason ?? "";
  const match = /^Stopped by ([^:]+):/.exec(terminationReason);
  if (!match) {
    return false;
  }
  const stoppedPhaseId = match[1];
  const stoppedIndex = flow.phases.findIndex((candidate) => candidate.id === stoppedPhaseId);
  const currentIndex = flow.phases.findIndex((candidate) => candidate.id === phase.id);
  if (stoppedIndex < 0 || currentIndex < 0) {
    return false;
  }
  return currentIndex > stoppedIndex;
}

export function displayStatusForPhase(
  flowState: FlowExecutionState | null,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
  actualStatus: FlowStatus | null,
): FlowStatus {
  if (actualStatus) {
    return actualStatus;
  }
  if (!flowState?.terminated) {
    return "pending";
  }
  return isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
}

export function displayStatusForStep(
  flowState: FlowExecutionState | null,
  flow: InteractiveFlowDefinition,
  phase: InteractiveFlowDefinition["phases"][number],
  actualStatus: FlowStatus | null,
): FlowStatus {
  if (actualStatus) {
    return actualStatus;
  }
  if (!flowState?.terminated) {
    return "pending";
  }
  return isAfterTermination(flowState, flow, phase) ? "skipped" : "pending";
}

export function statusForGroup(
  flow: InteractiveFlowDefinition,
  phases: InteractiveFlowDefinition["phases"],
  flowState: FlowExecutionState | null,
): FlowStatus {
  const statuses = phases.map((phase) =>
    displayStatusForPhase(
      flowState,
      flow,
      phase,
      flowState?.phases.find((candidate) => candidate.id === phase.id)?.status ?? null,
    ),
  );
  if (statuses.some((status) => status === "running")) {
    return "running";
  }
  if (statuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  if (statuses.every((status) => status === "done" || status === "skipped")) {
    return "done";
  }
  return "pending";
}

export function groupPhases(flow: InteractiveFlowDefinition): GroupedPhaseItem[] {
  const items: GroupedPhaseItem[] = [];

  let index = 0;
  while (index < flow.phases.length) {
    const phase = flow.phases[index];
    if (!phase) {
      break;
    }
    const label = repeatLabel(phase.repeatVars);
    if (!label) {
      items.push({ kind: "phase", phase });
      index += 1;
      continue;
    }

    const phases = [phase];
    let nextIndex = index + 1;
    while (nextIndex < flow.phases.length) {
      const candidate = flow.phases[nextIndex];
      if (!candidate || repeatGroupKey(candidate.repeatVars) !== repeatGroupKey(phase.repeatVars)) {
        break;
      }
      phases.push(candidate);
      nextIndex += 1;
    }
    items.push({ kind: "group", label, phases, seriesKey: repeatSeriesKey(phases) });
    index = nextIndex;
  }

  return items;
}

export function shouldDisplayPhase(
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
  phase: InteractiveFlowDefinition["phases"][number],
): boolean {
  const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id) ?? null;
  if (!flowState) {
    return true;
  }
  if (phaseState?.status === "skipped" && flowState.terminated && isAfterTermination(flowState, flow, phase)) {
    return false;
  }
  return true;
}

export function visiblePhaseItems(
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
): GroupedPhaseItem[] {
  const pendingSeries = new Set<string>();
  return groupPhases(flow).filter((item) => {
    if (item.kind === "phase") {
      return shouldDisplayPhase(flow, flowState, item.phase);
    }
    const visiblePhases = item.phases.filter((phase) => shouldDisplayPhase(flow, flowState, phase));
    const hasState = visiblePhases.some((phase) => flowState?.phases.some((candidate) => candidate.id === phase.id));
    if (visiblePhases.length === 0) {
      return false;
    }
    if (hasState) {
      return true;
    }
    if (pendingSeries.has(item.seriesKey)) {
      return false;
    }
    pendingSeries.add(item.seriesKey);
    return true;
  });
}

export function buildProgressViewModel(
  flow: InteractiveFlowDefinition | null,
  flowState: FlowExecutionState | null,
  options: {
    failedFlowId?: string | null;
    waitingForUserInput?: boolean;
  } = {},
): ProgressViewModel {
  if (!flow) {
    return {
      flow: null,
      items: [],
      anchorIndex: null,
    };
  }

  if (flow.autoFlow) {
    return buildAutoFlowProgressViewModel(flow, flowState, options);
  }

  const items: ProgressViewModelItem[] = [];
  let anchorIndex: number | null = null;
  let sawExecutedItem = false;

  const rememberAnchor = (status: FlowStatus): void => {
    if (status === "running") {
      anchorIndex = items.length;
      sawExecutedItem = true;
      return;
    }
    if (status === "done" || status === "skipped") {
      sawExecutedItem = true;
      return;
    }
    if (status === "pending" && sawExecutedItem && anchorIndex === null) {
      anchorIndex = items.length;
    }
  };

  for (const item of visiblePhaseItems(flow, flowState)) {
    if (item.kind === "group") {
      const visiblePhases = item.phases.filter((phase) => shouldDisplayPhase(flow, flowState, phase));
      if (visiblePhases.length === 0) {
        continue;
      }
      const groupStatus = statusForGroup(flow, visiblePhases, flowState);
      rememberAnchor(groupStatus);
      items.push({
        kind: "group",
        label: item.label,
        depth: 0,
        status: groupStatus,
      });

      for (const phase of visiblePhases) {
        const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
        const phaseStatus = displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
        rememberAnchor(phaseStatus);
        items.push({
          kind: "phase",
          label: displayPhaseId(phase),
          depth: 1,
          status: phaseStatus,
        });

        for (const step of phase.steps) {
          const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
          const stepStatus = displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
          rememberAnchor(stepStatus);
          items.push({
            kind: "step",
            label: step.id,
            depth: 2,
            status: stepStatus,
          });
        }
      }
      continue;
    }

    const phase = item.phase;
    if (!shouldDisplayPhase(flow, flowState, phase)) {
      continue;
    }
    const phaseState = flowState?.phases.find((candidate) => candidate.id === phase.id);
    const phaseStatus = displayStatusForPhase(flowState, flow, phase, phaseState?.status ?? null);
    rememberAnchor(phaseStatus);
    items.push({
      kind: "phase",
      label: displayPhaseId(phase),
      depth: 0,
      status: phaseStatus,
    });

    for (const step of phase.steps) {
      const stepState = phaseState?.steps.find((candidate) => candidate.id === step.id);
      const stepStatus = displayStatusForStep(flowState, flow, phase, stepState?.status ?? null);
      rememberAnchor(stepStatus);
      items.push({
        kind: "step",
        label: step.id,
        depth: 1,
        status: stepStatus,
      });
    }
  }

  if (flowState?.terminated) {
    const terminationOutcome = flowState.terminationOutcome ?? "success";
    items.push({
      kind: "termination",
      label: terminationOutcome === "stopped" ? "Flow stopped before completion" : "Flow completed successfully",
      detail: `Reason: ${flowState.terminationReason ?? "flow terminated"}`,
      depth: 0,
      status: terminationOutcome === "stopped" ? "running" : "done",
    });
  }

  return {
    flow,
    items,
    anchorIndex,
  };
}

function phaseOrder(flow: InteractiveFlowDefinition): Map<string, number> {
  return new Map(flow.phases.map((phase, index) => [phase.id, index]));
}

function stoppedPhaseId(flowState: FlowExecutionState | null): string | null {
  const terminationReason = flowState?.terminationReason ?? "";
  const match = /^Stopped by ([^:]+):/.exec(terminationReason);
  return match?.[1] ?? null;
}

function mapRuntimeStatus(status: FlowStatus): AutoFlowProgressStatus {
  if (status === "done") {
    return "success";
  }
  return status;
}

function lastRuntimeBlockId(
  slots: readonly AutoFlowSlotViewModel[],
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
): string | null {
  const order = phaseOrder(flow);
  let result: { blockId: string; phaseIndex: number } | null = null;
  for (const slot of slots) {
    for (const block of slot.blocks) {
      if (!block.phaseId) {
        continue;
      }
      const phaseState = flowState?.phases.find((phase) => phase.id === block.phaseId);
      if (!phaseState || phaseState.status === "pending" || phaseState.status === "skipped") {
        continue;
      }
      const phaseIndex = order.get(block.phaseId) ?? -1;
      if (!result || phaseIndex >= result.phaseIndex) {
        result = { blockId: block.blockId, phaseIndex };
      }
    }
  }
  return result?.blockId ?? null;
}

function runtimeStatusForBlock(
  block: AutoFlowBlockViewModel,
  input: {
    flow: InteractiveFlowDefinition;
    flowState: FlowExecutionState | null;
    failedFlowId?: string | null;
    waitingForUserInput?: boolean;
    fallbackFailedBlockId: string | null;
  },
): AutoFlowProgressStatus {
  if (block.status === "invalid" || block.status === "disabled" || block.status === "blocked" || block.status === "empty") {
    return block.status;
  }
  if (!block.phaseId) {
    return block.status;
  }
  const phaseState = input.flowState?.phases.find((phase) => phase.id === block.phaseId) ?? null;
  const failed = input.failedFlowId === input.flow.id;
  if (failed && (phaseState?.status === "running" || input.fallbackFailedBlockId === block.blockId)) {
    return "failed";
  }
  if (input.waitingForUserInput && phaseState?.status === "running") {
    return "waiting-user";
  }
  const stoppedId = input.flowState?.terminationOutcome === "stopped" ? stoppedPhaseId(input.flowState) : null;
  if (stoppedId && stoppedId === block.phaseId) {
    return "stopped";
  }
  if (phaseState) {
    return mapRuntimeStatus(phaseState.status);
  }
  if (input.flowState?.terminated && stoppedId) {
    const order = phaseOrder(input.flow);
    const stoppedIndex = order.get(stoppedId) ?? -1;
    const currentIndex = order.get(block.phaseId) ?? -1;
    if (stoppedIndex >= 0 && currentIndex > stoppedIndex) {
      return "skipped";
    }
  }
  return block.status;
}

function aggregateSlotStatus(
  slot: AutoFlowSlotViewModel,
  blockStatuses: readonly AutoFlowProgressStatus[],
): AutoFlowProgressStatus {
  if (slot.status === "invalid" || blockStatuses.some((status) => status === "invalid")) {
    return "invalid";
  }
  if (slot.blocks.length === 0) {
    return "empty";
  }
  for (const status of ["failed", "stopped", "waiting-user", "running"] as const) {
    if (blockStatuses.includes(status)) {
      return status;
    }
  }
  if (blockStatuses.every((status) => status === "disabled")) {
    return "disabled";
  }
  const executableStatuses = blockStatuses.filter((status) => status !== "disabled");
  if (executableStatuses.length > 0 && executableStatuses.every((status) => status === "success" || status === "skipped")) {
    return executableStatuses.every((status) => status === "skipped") ? "skipped" : "success";
  }
  if (blockStatuses.some((status) => status === "blocked")) {
    return "blocked";
  }
  return "pending";
}

function rememberProgressAnchor(
  items: readonly ProgressViewModelItem[],
  status: ProgressDisplayStatus,
  state: { anchorIndex: number | null; sawExecutedItem: boolean },
): void {
  if (status === "running" || status === "waiting-user" || status === "failed" || status === "stopped" || status === "invalid") {
    state.anchorIndex = items.length;
    state.sawExecutedItem = true;
    return;
  }
  if (status === "done" || status === "success" || status === "skipped" || status === "disabled") {
    state.sawExecutedItem = true;
    return;
  }
  if (status === "pending" && state.sawExecutedItem && state.anchorIndex === null) {
    state.anchorIndex = items.length;
  }
}

function diagnosticDetail(reason: string, diagnostics: readonly unknown[]): { detail?: string } {
  const detail = reason.trim();
  if (diagnostics.length === 0 || detail.length === 0) {
    return {};
  }
  return { detail };
}

function buildAutoFlowProgressViewModel(
  flow: InteractiveFlowDefinition,
  flowState: FlowExecutionState | null,
  options: {
    failedFlowId?: string | null;
    waitingForUserInput?: boolean;
  },
): ProgressViewModel {
  if (!flow.autoFlow) {
    return {
      flow,
      items: [],
      anchorIndex: null,
    };
  }
  const editor = buildAutoFlowEditorViewModel(flow.autoFlow, {
    ...(flow.autoFlow.diagnostics && flow.autoFlow.diagnostics.length > 0 ? { diagnostics: flow.autoFlow.diagnostics } : {}),
    ...(flow.autoFlow.lastMessage ? { lastMessage: flow.autoFlow.lastMessage } : {}),
  });
  const items: ProgressViewModelItem[] = [];
  const anchorState = { anchorIndex: null as number | null, sawExecutedItem: false };
  const fallbackFailedBlockId = options.failedFlowId === flow.id
    ? lastRuntimeBlockId(editor.slots, flow, flowState)
    : null;

  for (const slot of editor.slots) {
    const blockRows = slot.blocks.map((block) => ({
      block,
      status: runtimeStatusForBlock(block, {
        flow,
        flowState,
        ...(options.failedFlowId !== undefined ? { failedFlowId: options.failedFlowId } : {}),
        ...(options.waitingForUserInput !== undefined ? { waitingForUserInput: options.waitingForUserInput } : {}),
        fallbackFailedBlockId,
      }),
    }));
    const status = aggregateSlotStatus(slot, blockRows.map((row) => row.status));
    rememberProgressAnchor(items, status, anchorState);
    items.push({
      kind: "slot",
      label: slot.title,
      depth: 0,
      status,
      ...diagnosticDetail(slot.reason, slot.diagnostics),
      slotId: slot.slotId,
    });
    for (const { block, status: blockRuntimeStatus } of blockRows) {
      rememberProgressAnchor(items, blockRuntimeStatus, anchorState);
      items.push({
        kind: "block",
        label: block.title,
        depth: 1,
        status: blockRuntimeStatus,
        ...diagnosticDetail(block.reason, block.diagnostics),
        slotId: block.slotId,
        blockId: block.blockId,
        locked: block.locked,
        enabled: block.enabled,
      });
      for (const diagnostic of block.diagnostics) {
        rememberProgressAnchor(items, "invalid", anchorState);
        const detail = diagnostic.paramName ? `${diagnostic.blockId ?? "flow"}.${diagnostic.paramName}` : diagnostic.blockId;
        items.push({
          kind: "block",
          label: diagnostic.message,
          depth: 2,
          status: "invalid",
          ...(detail ? { detail } : {}),
          slotId: block.slotId,
          blockId: block.blockId,
          locked: block.locked,
          enabled: block.enabled,
        });
      }
    }
  }

  if (flowState?.terminated) {
    const terminationOutcome = flowState.terminationOutcome ?? "success";
    const status = terminationOutcome === "stopped" ? "stopped" : "success";
    items.push({
      kind: "termination",
      label: terminationOutcome === "stopped" ? "Flow stopped before completion" : "Flow completed successfully",
      detail: `Reason: ${flowState.terminationReason ?? "flow terminated"}`,
      depth: 0,
      status,
    });
  }

  return {
    flow,
    items,
    anchorIndex: anchorState.anchorIndex,
  };
}
