import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("auto flow config loading", () => {
  it("accepts v2 configs and rejects obsolete basePreset", () => {
    const config = validateAutoFlowConfigValue({
      kind: "auto-flow-config",
      version: 2,
      name: "backend-standard",
      slots: {
        review: { blocks: [{ id: "review.loop", enabled: true }] },
      },
    }, "backend-standard", "sample.yaml");

    assert.equal(config.version, 2);
    assert.equal("basePreset" in config, false);

    assert.throws(
      () => validateAutoFlowConfigValue({
        kind: "auto-flow-config",
        version: 2,
        name: "backend-standard",
        basePreset: "standard",
      }, "backend-standard", "bad.yaml"),
      /unsupported key 'basePreset'/,
    );
  });

  it("loads project configs before user configs and normalizes v1 standard to v2", () => {
    const projectConfig = path.join(tempDir, ".agentweaver", "flow-configs", "backend-standard.yaml");
    const userConfig = path.join(process.env.HOME, ".agentweaver", "flow-configs", "backend-standard.yaml");
    writeConfig(projectConfig, "kind: auto-flow-config\nversion: 1\nname: backend-standard\nbasePreset: standard\n");
    writeConfig(userConfig, "kind: auto-flow-config\nversion: 1\nname: backend-standard\nbasePreset: simple\n");

    const loaded = loadAutoFlowConfigByName("backend-standard", tempDir);
    assert.equal(loaded.config.version, 2);
    assert.equal("basePreset" in loaded.config, false);
    assert.equal(loaded.source.type, "project");
    assert.equal(loaded.source.path, projectConfig);
    assert.equal(loaded.source.shadowedUserPath, userConfig);
  });

  it("migrates v1 simple by disabling design review only when absent", () => {
    const absent = validateAutoFlowConfigValue({
      kind: "auto-flow-config",
      version: 1,
      name: "simple-absent",
      basePreset: "simple",
    }, "simple-absent", "simple.yaml");
    assert.deepEqual(absent.slots.designReview.blocks, [{ id: "review.design-loop", enabled: false }]);

    const explicit = validateAutoFlowConfigValue({
      kind: "auto-flow-config",
      version: 1,
      name: "simple-explicit",
      basePreset: "simple",
      slots: {
        designReview: { blocks: [{ id: "review.design-loop", enabled: true, maxIterations: 2 }] },
      },
    }, "simple-explicit", "simple.yaml");
    assert.deepEqual(explicit.slots.designReview.blocks, [{ id: "review.design-loop", enabled: true, maxIterations: 2 }]);
  });

  it("saves migrated configs as v2 YAML without basePreset", () => {
    const migrated = validateAutoFlowConfigValue({
      kind: "auto-flow-config",
      version: 1,
      name: "backend-standard",
      basePreset: "standard",
    }, "backend-standard", "sample.yaml");

    const result = saveAutoFlowConfig(migrated, { cwd: tempDir, location: "project" });
    const yaml = readFileSync(result.source.path, "utf8");
    assert.match(yaml, /version: 2/);
    assert.doesNotMatch(yaml, /basePreset/);
  });

  it("reports targeted validation errors", () => {
    assert.throws(
      () => validateAutoFlowConfigValue({
        kind: "auto-flow-config",
        version: 2,
        name: "backend-standard",
        slots: { review: { blocks: [{ id: "review.loop", enabled: "sometimes" }] } },
      }, "backend-standard", "bad.yaml"),
      /backend-standard.*enabled must be true, false, or auto/,
    );

    assert.throws(
      () => validateAutoFlowConfigValue({
        kind: "auto-flow-config",
        version: 2,
        name: "backend-standard",
        slots: { unknownSlot: { blocks: [] } },
      }, "backend-standard", "bad.yaml"),
      /backend-standard.*unknown slot 'unknownSlot'/,
    );
  });
});
