import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agentweaverConfigDir } from "./env-loader.js";

export type WebUiTheme = "light" | "dark";

export type AgentWeaverWebUiSettings = {
  theme: WebUiTheme;
  autoFlowHeight: number | null;
  workspaceSplit: number;
  logAutoscroll: boolean;
};

export type AgentWeaverWebUiSettingsPatch = Partial<AgentWeaverWebUiSettings>;

export type AgentWeaverSettings = {
  kind: "agentweaver-settings";
  version: 1;
  webUi: AgentWeaverWebUiSettings;
};

export const WEB_UI_AUTO_FLOW_HEIGHT_MIN = 120;
export const WEB_UI_AUTO_FLOW_HEIGHT_MAX = 640;
export const WEB_UI_WORKSPACE_SPLIT_MIN = 24;
export const WEB_UI_WORKSPACE_SPLIT_MAX = 58;

export const DEFAULT_AGENTWEAVER_WEB_UI_SETTINGS: AgentWeaverWebUiSettings = {
  theme: "light",
  autoFlowHeight: null,
  workspaceSplit: 36,
  logAutoscroll: true,
};

export function agentweaverSettingsPath(): string {
  return path.join(agentweaverConfigDir(), "settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeTheme(value: unknown, fallback: WebUiTheme): WebUiTheme {
  return value === "dark" || value === "light" ? value : fallback;
}

export function normalizeWebUiSettings(value: unknown): AgentWeaverWebUiSettings {
  const raw = isRecord(value) ? value : {};
  const defaults = DEFAULT_AGENTWEAVER_WEB_UI_SETTINGS;
  const rawHeight = raw["autoFlowHeight"];
  const autoFlowHeight = rawHeight === null
    ? null
    : Number.isFinite(Number(rawHeight))
      ? clampInteger(rawHeight, WEB_UI_AUTO_FLOW_HEIGHT_MIN, WEB_UI_AUTO_FLOW_HEIGHT_MAX, defaults.autoFlowHeight ?? WEB_UI_AUTO_FLOW_HEIGHT_MAX)
      : defaults.autoFlowHeight;

  return {
    theme: normalizeTheme(raw["theme"], defaults.theme),
    autoFlowHeight,
    workspaceSplit: clampInteger(raw["workspaceSplit"], WEB_UI_WORKSPACE_SPLIT_MIN, WEB_UI_WORKSPACE_SPLIT_MAX, defaults.workspaceSplit),
    logAutoscroll: typeof raw["logAutoscroll"] === "boolean" ? raw["logAutoscroll"] : defaults.logAutoscroll,
  };
}

export function normalizeWebUiSettingsPatch(patch: AgentWeaverWebUiSettingsPatch): AgentWeaverWebUiSettingsPatch {
  const normalized: AgentWeaverWebUiSettingsPatch = {};
  if (patch.theme !== undefined) {
    normalized.theme = normalizeTheme(patch.theme, DEFAULT_AGENTWEAVER_WEB_UI_SETTINGS.theme);
  }
  if ("autoFlowHeight" in patch) {
    normalized.autoFlowHeight = patch.autoFlowHeight === null || patch.autoFlowHeight === undefined
      ? null
      : clampInteger(
        patch.autoFlowHeight,
        WEB_UI_AUTO_FLOW_HEIGHT_MIN,
        WEB_UI_AUTO_FLOW_HEIGHT_MAX,
        WEB_UI_AUTO_FLOW_HEIGHT_MAX,
      );
  }
  if (patch.workspaceSplit !== undefined) {
    normalized.workspaceSplit = clampInteger(
      patch.workspaceSplit,
      WEB_UI_WORKSPACE_SPLIT_MIN,
      WEB_UI_WORKSPACE_SPLIT_MAX,
      DEFAULT_AGENTWEAVER_WEB_UI_SETTINGS.workspaceSplit,
    );
  }
  if (patch.logAutoscroll !== undefined) {
    normalized.logAutoscroll = Boolean(patch.logAutoscroll);
  }
  return normalized;
}

function readRawSettings(): Record<string, unknown> {
  const filePath = agentweaverSettingsPath();
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

export function loadAgentWeaverSettings(): AgentWeaverSettings {
  const raw = readRawSettings();
  return {
    kind: "agentweaver-settings",
    version: 1,
    webUi: normalizeWebUiSettings(raw["webUi"]),
  };
}

export function saveAgentWeaverSettings(settings: AgentWeaverSettings): AgentWeaverSettings {
  const raw = readRawSettings();
  const normalized: AgentWeaverSettings = {
    kind: "agentweaver-settings",
    version: 1,
    webUi: normalizeWebUiSettings(settings.webUi),
  };
  writeJsonAtomic(agentweaverSettingsPath(), {
    ...raw,
    ...normalized,
  });
  return normalized;
}

export function updateWebUiSettings(patch: AgentWeaverWebUiSettingsPatch): AgentWeaverWebUiSettings {
  const current = loadAgentWeaverSettings();
  const next = saveAgentWeaverSettings({
    ...current,
    webUi: {
      ...current.webUi,
      ...normalizeWebUiSettingsPatch(patch),
    },
  });
  return next.webUi;
}
