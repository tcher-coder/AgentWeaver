import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const {
  agentweaverSettingsPath,
  loadAgentWeaverSettings,
  updateWebUiSettings,
} = await import(pathToFileURL(path.join(distRoot, "runtime/settings.js")).href);

let tempDir;
let originalHome;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-settings-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempDir, "home");
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("AgentWeaver settings", () => {
  it("loads default Web UI settings when the global file is missing", () => {
    assert.deepEqual(loadAgentWeaverSettings().webUi, {
      theme: "light",
      autoFlowHeight: null,
      workspaceSplit: 36,
      logAutoscroll: true,
    });
  });

  it("persists and normalizes Web UI settings under the global config directory", () => {
    const updated = updateWebUiSettings({
      theme: "dark",
      autoFlowHeight: 99,
      workspaceSplit: 99,
      logAutoscroll: false,
    });

    assert.deepEqual(updated, {
      theme: "dark",
      autoFlowHeight: 120,
      workspaceSplit: 58,
      logAutoscroll: false,
    });

    const filePath = agentweaverSettingsPath();
    assert.equal(filePath, path.join(process.env.HOME, ".agentweaver", "settings.json"));
    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(stored.kind, "agentweaver-settings");
    assert.equal(stored.version, 1);
    assert.deepEqual(stored.webUi, updated);
  });

  it("ignores corrupt values and preserves unrelated global settings on update", () => {
    const filePath = agentweaverSettingsPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      kind: "agentweaver-settings",
      version: 1,
      otherTool: { enabled: true },
      webUi: {
        theme: "sepia",
        autoFlowHeight: "tall",
        workspaceSplit: 12,
        logAutoscroll: "yes",
      },
    }, null, 2), "utf8");

    assert.deepEqual(loadAgentWeaverSettings().webUi, {
      theme: "light",
      autoFlowHeight: null,
      workspaceSplit: 24,
      logAutoscroll: true,
    });

    const updated = updateWebUiSettings({ workspaceSplit: 42 });
    const stored = JSON.parse(readFileSync(filePath, "utf8"));
    assert.deepEqual(updated, {
      theme: "light",
      autoFlowHeight: null,
      workspaceSplit: 42,
      logAutoscroll: true,
    });
    assert.deepEqual(stored.otherTool, { enabled: true });
    assert.deepEqual(stored.webUi, updated);
  });
});
