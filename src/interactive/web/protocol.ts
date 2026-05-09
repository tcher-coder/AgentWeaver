import type { UserInputFormValues } from "../../user-input.js";
import type { AgentWeaverWebUiSettings, AgentWeaverWebUiSettingsPatch } from "../../runtime/settings.js";
import type { FocusPane } from "../types.js";
import type { InteractiveSessionViewModel } from "../view-model.js";

export type ServerEvent =
  | { type: "snapshot"; viewModel: InteractiveSessionViewModel; settings?: AgentWeaverWebUiSettings }
  | { type: "log.append"; appendedLines: string[] }
  | { type: "error"; message: string; requestId?: string; actionId?: string }
  | { type: "closed"; reason?: string };

export type ClientAction =
  | { type: "flow.select"; index?: number; key?: string; actionId?: string }
  | { type: "folder.toggle"; key: string; actionId?: string }
  | { type: "run.openConfirm"; flowId?: string; key?: string; actionId?: string }
  | { type: "confirm.select"; action: string; actionId?: string }
  | { type: "confirm.accept"; action?: string; actionId?: string }
  | { type: "confirm.cancel"; actionId?: string }
  | { type: "form.update"; values: UserInputFormValues; actionId?: string }
  | { type: "form.fieldUpdate"; fieldId: string; value: UserInputFormValues[string]; actionId?: string }
  | { type: "form.submit"; values?: UserInputFormValues; actionId?: string }
  | { type: "form.cancel"; actionId?: string }
  | { type: "interrupt.openConfirm"; actionId?: string }
  | { type: "flow.interrupt"; flowId?: string; actionId?: string }
  | { type: "log.clear"; actionId?: string }
  | { type: "artifactExplorer.open"; actionId?: string }
  | { type: "artifactExplorer.close"; actionId?: string }
  | { type: "autoFlow.selectPreset"; preset: "simple" | "standard"; actionId?: string }
  | { type: "autoFlow.loadConfig"; name: string; flowId?: string; actionId?: string }
  | { type: "autoFlow.save"; flowId?: string; name?: string; location?: "project" | "user"; actionId?: string }
  | { type: "autoFlow.reset"; flowId?: string; actionId?: string }
  | { type: "autoFlow.toggleBlock"; flowId?: string; slotId?: string; blockId: string; enabled?: boolean; actionId?: string }
  | { type: "autoFlow.updateParam"; flowId?: string; slotId?: string; blockId: string; paramName: string; value: number; actionId?: string }
  | { type: "autoFlow.insertBlock"; flowId?: string; slotId: string; blockId: string; actionId?: string }
  | { type: "autoFlow.removeBlock"; flowId?: string; slotId: string; blockId: string; actionId?: string }
  | { type: "git.refresh"; actionId?: string }
  | { type: "git.createBranch"; branchName: string; actionId?: string }
  | { type: "git.checkout"; branchName: string; actionId?: string }
  | { type: "git.fetch"; actionId?: string }
  | { type: "git.pullFfOnly"; actionId?: string }
  | { type: "git.stage"; paths: string[]; actionId?: string }
  | { type: "git.unstage"; paths: string[]; actionId?: string }
  | { type: "git.updateCommitMessage"; message: string; actionId?: string }
  | { type: "git.commit"; message: string; paths?: string[]; actionId?: string }
  | { type: "git.push"; actionId?: string }
  | { type: "settings.update"; settings: AgentWeaverWebUiSettingsPatch; actionId?: string }
  | { type: "help.toggle"; visible?: boolean; actionId?: string }
  | { type: "scroll"; pane: FocusPane | "help"; delta?: number; offset?: number; actionId?: string };

const ACTION_TYPES = new Set([
  "flow.select",
  "folder.toggle",
  "run.openConfirm",
  "confirm.select",
  "confirm.accept",
  "confirm.cancel",
  "form.update",
  "form.fieldUpdate",
  "form.submit",
  "form.cancel",
  "interrupt.openConfirm",
  "flow.interrupt",
  "log.clear",
  "artifactExplorer.open",
  "artifactExplorer.close",
  "autoFlow.selectPreset",
  "autoFlow.loadConfig",
  "autoFlow.save",
  "autoFlow.reset",
  "autoFlow.toggleBlock",
  "autoFlow.updateParam",
  "autoFlow.insertBlock",
  "autoFlow.removeBlock",
  "git.refresh",
  "git.createBranch",
  "git.checkout",
  "git.fetch",
  "git.pullFfOnly",
  "git.stage",
  "git.unstage",
  "git.updateCommitMessage",
  "git.commit",
  "git.push",
  "settings.update",
  "help.toggle",
  "scroll",
]);

const SCROLL_PANES = new Set(["flows", "progress", "summary", "log", "help"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalActionId(value: Record<string, unknown>): string | undefined {
  if (value.actionId === undefined) {
    return undefined;
  }
  if (typeof value.actionId !== "string" || value.actionId.trim().length === 0) {
    throw new Error("actionId must be a non-empty string when provided.");
  }
  return value.actionId;
}

function requireNonEmptyString(value: Record<string, unknown>, fieldName: string): string {
  const field = value[fieldName];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return field;
}

function optionalNonEmptyString(value: Record<string, unknown>, fieldName: string): string | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, fieldName);
}

function optionalInteger(value: Record<string, unknown>, fieldName: string): number | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  const field = value[fieldName];
  if (typeof field !== "number" || !Number.isInteger(field)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return field;
}

function optionalBoolean(value: Record<string, unknown>, fieldName: string): boolean | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  const field = value[fieldName];
  if (typeof field !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return field;
}

function requireSettingsPatch(value: Record<string, unknown>): AgentWeaverWebUiSettingsPatch {
  const settings = value.settings;
  if (!isRecord(settings)) {
    throw new Error("settings must be an object.");
  }
  const allowed = new Set(["theme", "autoFlowHeight", "workspaceSplit", "logAutoscroll"]);
  for (const key of Object.keys(settings)) {
    if (!allowed.has(key)) {
      throw new Error(`Unsupported settings key: ${key}`);
    }
  }
  const patch: AgentWeaverWebUiSettingsPatch = {};
  if ("theme" in settings) {
    const theme = settings.theme;
    if (theme !== "dark" && theme !== "light") {
      throw new Error("settings.theme must be light or dark.");
    }
    patch.theme = theme;
  }
  if ("autoFlowHeight" in settings) {
    const autoFlowHeight = settings.autoFlowHeight;
    if (
      autoFlowHeight !== null
      && (typeof autoFlowHeight !== "number" || !Number.isFinite(autoFlowHeight))
    ) {
      throw new Error("settings.autoFlowHeight must be a finite number or null.");
    }
    patch.autoFlowHeight = autoFlowHeight;
  }
  if ("workspaceSplit" in settings) {
    const workspaceSplit = settings.workspaceSplit;
    if (typeof workspaceSplit !== "number" || !Number.isFinite(workspaceSplit)) {
      throw new Error("settings.workspaceSplit must be a finite number.");
    }
    patch.workspaceSplit = workspaceSplit;
  }
  if ("logAutoscroll" in settings) {
    const logAutoscroll = settings.logAutoscroll;
    if (typeof logAutoscroll !== "boolean") {
      throw new Error("settings.logAutoscroll must be a boolean.");
    }
    patch.logAutoscroll = logAutoscroll;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("settings.update requires at least one setting.");
  }
  return patch;
}

function requireValues(value: Record<string, unknown>, fieldName = "values"): UserInputFormValues {
  const values = value[fieldName];
  if (!isRecord(values)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return values as UserInputFormValues;
}

function requireStringArray(value: Record<string, unknown>, fieldName: string): string[] {
  const field = value[fieldName];
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${fieldName} must be an array of non-empty strings.`);
  }
  return field;
}

function optionalStringArray(value: Record<string, unknown>, fieldName: string): string[] | undefined {
  if (value[fieldName] === undefined) {
    return undefined;
  }
  return requireStringArray(value, fieldName);
}

function requireCommitMessage(value: Record<string, unknown>): string {
  const message = value.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("message must be a non-empty string.");
  }
  return message;
}

export function parseClientAction(raw: string): ClientAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Protocol message must be valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Protocol message requires a string type.");
  }
  if (!ACTION_TYPES.has(parsed.type)) {
    throw new Error(`Unknown protocol action: ${parsed.type}`);
  }

  const actionId = optionalActionId(parsed);
  if (parsed.type === "flow.select") {
    const index = optionalInteger(parsed, "index");
    const key = optionalNonEmptyString(parsed, "key");
    if (index === undefined && key === undefined) {
      throw new Error("flow.select requires index or key.");
    }
    return { type: "flow.select", ...(index !== undefined ? { index } : {}), ...(key ? { key } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "folder.toggle") {
    return { type: "folder.toggle", key: requireNonEmptyString(parsed, "key"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "run.openConfirm") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    const key = optionalNonEmptyString(parsed, "key");
    return { type: "run.openConfirm", ...(flowId ? { flowId } : {}), ...(key ? { key } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "confirm.select") {
    return { type: "confirm.select", action: requireNonEmptyString(parsed, "action"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "confirm.accept") {
    const action = optionalNonEmptyString(parsed, "action");
    return { type: "confirm.accept", ...(action ? { action } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (
    parsed.type === "confirm.cancel"
    || parsed.type === "form.cancel"
    || parsed.type === "log.clear"
    || parsed.type === "artifactExplorer.open"
    || parsed.type === "artifactExplorer.close"
    || parsed.type === "git.refresh"
    || parsed.type === "git.fetch"
    || parsed.type === "git.pullFfOnly"
    || parsed.type === "git.push"
  ) {
    return { type: parsed.type, ...(actionId ? { actionId } : {}) } as ClientAction;
  }
  if (parsed.type === "form.update") {
    return { type: "form.update", values: requireValues(parsed), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "form.fieldUpdate") {
    const fieldId = requireNonEmptyString(parsed, "fieldId");
    if (!("value" in parsed)) {
      throw new Error("value is required.");
    }
    const value = parsed.value;
    if (
      typeof value !== "string"
      && typeof value !== "boolean"
      && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    ) {
      throw new Error("value must be a string, boolean, or string array.");
    }
    return { type: "form.fieldUpdate", fieldId, value, ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "form.submit") {
    return {
      type: "form.submit",
      ...(parsed.values !== undefined ? { values: requireValues(parsed) } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "interrupt.openConfirm") {
    return { type: "interrupt.openConfirm", ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "flow.interrupt") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return { type: "flow.interrupt", ...(flowId ? { flowId } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "autoFlow.selectPreset") {
    const preset = requireNonEmptyString(parsed, "preset");
    if (preset !== "simple" && preset !== "standard") {
      throw new Error("preset must be simple or standard.");
    }
    return { type: "autoFlow.selectPreset", preset, ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "autoFlow.loadConfig") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return {
      type: "autoFlow.loadConfig",
      name: requireNonEmptyString(parsed, "name"),
      ...(flowId ? { flowId } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "autoFlow.save") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    const name = optionalNonEmptyString(parsed, "name");
    const location = optionalNonEmptyString(parsed, "location");
    if (location !== undefined && location !== "project" && location !== "user") {
      throw new Error("location must be project or user.");
    }
    return {
      type: "autoFlow.save",
      ...(flowId ? { flowId } : {}),
      ...(name ? { name } : {}),
      ...(location ? { location } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "autoFlow.reset") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return { type: "autoFlow.reset", ...(flowId ? { flowId } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "autoFlow.toggleBlock") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    const slotId = optionalNonEmptyString(parsed, "slotId");
    const enabled = optionalBoolean(parsed, "enabled");
    return {
      type: "autoFlow.toggleBlock",
      ...(flowId ? { flowId } : {}),
      ...(slotId ? { slotId } : {}),
      blockId: requireNonEmptyString(parsed, "blockId"),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "autoFlow.updateParam") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    const slotId = optionalNonEmptyString(parsed, "slotId");
    return {
      type: "autoFlow.updateParam",
      ...(flowId ? { flowId } : {}),
      ...(slotId ? { slotId } : {}),
      blockId: requireNonEmptyString(parsed, "blockId"),
      paramName: requireNonEmptyString(parsed, "paramName"),
      value: optionalInteger(parsed, "value") ?? (() => {
        throw new Error("value must be an integer.");
      })(),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "autoFlow.insertBlock") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return {
      type: "autoFlow.insertBlock",
      ...(flowId ? { flowId } : {}),
      slotId: requireNonEmptyString(parsed, "slotId"),
      blockId: requireNonEmptyString(parsed, "blockId"),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "autoFlow.removeBlock") {
    const flowId = optionalNonEmptyString(parsed, "flowId");
    return {
      type: "autoFlow.removeBlock",
      ...(flowId ? { flowId } : {}),
      slotId: requireNonEmptyString(parsed, "slotId"),
      blockId: requireNonEmptyString(parsed, "blockId"),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "help.toggle") {
    if (parsed.visible !== undefined && typeof parsed.visible !== "boolean") {
      throw new Error("visible must be a boolean when provided.");
    }
    return { type: "help.toggle", ...(parsed.visible !== undefined ? { visible: parsed.visible } : {}), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.createBranch") {
    if ("selectedBase" in parsed || "base" in parsed || "baseBranch" in parsed) {
      throw new Error("git.createBranch does not accept a selected base in the MVP.");
    }
    return { type: "git.createBranch", branchName: requireNonEmptyString(parsed, "branchName"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.checkout") {
    return { type: "git.checkout", branchName: requireNonEmptyString(parsed, "branchName"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.stage") {
    return { type: "git.stage", paths: requireStringArray(parsed, "paths"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.unstage") {
    return { type: "git.unstage", paths: requireStringArray(parsed, "paths"), ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.updateCommitMessage") {
    if (typeof parsed.message !== "string") {
      throw new Error("message must be a string.");
    }
    return { type: "git.updateCommitMessage", message: parsed.message, ...(actionId ? { actionId } : {}) };
  }
  if (parsed.type === "git.commit") {
    const paths = optionalStringArray(parsed, "paths");
    return {
      type: "git.commit",
      message: requireCommitMessage(parsed),
      ...(paths !== undefined ? { paths } : {}),
      ...(actionId ? { actionId } : {}),
    };
  }
  if (parsed.type === "settings.update") {
    return { type: "settings.update", settings: requireSettingsPatch(parsed), ...(actionId ? { actionId } : {}) };
  }

  const pane = requireNonEmptyString(parsed, "pane");
  if (!SCROLL_PANES.has(pane)) {
    throw new Error("scroll pane must be one of flows, progress, summary, log, or help.");
  }
  const delta = optionalInteger(parsed, "delta");
  const offset = optionalInteger(parsed, "offset");
  if (delta === undefined && offset === undefined) {
    throw new Error("scroll requires delta or offset.");
  }
  return {
    type: "scroll",
    pane: pane as FocusPane | "help",
    ...(delta !== undefined ? { delta } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(actionId ? { actionId } : {}),
  };
}
