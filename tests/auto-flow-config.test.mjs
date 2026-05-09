import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const {
  loadAutoFlowConfigByName,
  saveAutoFlowConfig,
  validateAutoFlowConfigValue,
} = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-config.js")).href);

let tempDir;
let originalHome;

function writeConfig(filePath, body) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-flow-config-"));
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

describe("auto flow config loading", () => {
  it("loads project configs before user configs", () => {
    const projectConfig = path.join(tempDir, ".agentweaver", "flow-configs", "backend-standard.yaml");
    const userConfig = path.join(process.env.HOME, ".agentweaver", "flow-configs", "backend-standard.yaml");
    writeConfig(projectConfig, [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: standard",
      "",
    ].join("\n"));
    writeConfig(userConfig, [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: simple",
      "",
    ].join("\n"));

    const loaded = loadAutoFlowConfigByName("backend-standard", tempDir);
    assert.equal(loaded.config.basePreset, "standard");
    assert.equal(loaded.source.type, "project");
    assert.equal(loaded.source.path, projectConfig);
    assert.equal(loaded.source.shadowedUserPath, userConfig);
  });

  it("falls back to the user config when no project config exists", () => {
    const userConfig = path.join(process.env.HOME, ".agentweaver", "flow-configs", "backend-standard.yaml");
    writeConfig(userConfig, [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: simple",
      "",
    ].join("\n"));

    const loaded = loadAutoFlowConfigByName("backend-standard", tempDir);
    assert.equal(loaded.config.basePreset, "simple");
    assert.equal(loaded.source.type, "user");
    assert.equal(loaded.source.path, userConfig);
  });

  it("validates the planning sample slot shape", () => {
    const config = validateAutoFlowConfigValue({
      kind: "auto-flow-config",
      version: 1,
      name: "backend-standard",
      basePreset: "standard",
      slots: {
        designReview: {
          blocks: [{ id: "review.design-loop", enabled: true, maxIterations: 2 }],
        },
        postImplementationChecks: {
          blocks: [{ id: "checks.go.linter", enabled: "auto", maxIterations: 3 }],
        },
        review: {
          blocks: [{ id: "review.loop", enabled: true }],
        },
        final: {
          blocks: [],
        },
      },
    }, "backend-standard", "sample.yaml");

    assert.equal(config.basePreset, "standard");
    assert.equal(config.slots.designReview.blocks[0].maxIterations, 2);
    assert.equal(config.slots.postImplementationChecks.blocks[0].enabled, "auto");
  });

  it("reports targeted validation errors", () => {
    assert.throws(
      () => validateAutoFlowConfigValue({
        kind: "auto-flow-config",
        version: 1,
        name: "backend-standard",
        basePreset: "standard",
        slots: {
          review: {
            blocks: [{ id: "review.loop", enabled: "sometimes" }],
          },
        },
      }, "backend-standard", "bad.yaml"),
      /backend-standard.*enabled must be true, false, or auto/,
    );

    assert.throws(
      () => validateAutoFlowConfigValue({
        kind: "auto-flow-config",
        version: 1,
        name: "backend-standard",
        basePreset: "standard",
        slots: {
          unknownSlot: { blocks: [] },
        },
      }, "backend-standard", "bad.yaml"),
      /backend-standard.*unknown slot 'unknownSlot'/,
    );
  });

  it("rejects maxIterations values above metadata bounds before save or run", () => {
    const invalid = {
      kind: "auto-flow-config",
      version: 1,
      name: "backend-standard",
      basePreset: "standard",
      slots: {
        review: {
          blocks: [{ id: "review.loop", enabled: true, maxIterations: 6 }],
        },
      },
    };

    assert.throws(
      () => validateAutoFlowConfigValue(invalid, "backend-standard", "bad.yaml"),
      /maxIterations for block 'review\.loop' must be between 1 and 5; received 6/,
    );
    assert.throws(
      () => saveAutoFlowConfig(invalid, { cwd: tempDir, location: "project" }),
      /maxIterations for block 'review\.loop' must be between 1 and 5; received 6/,
    );
  });
});
