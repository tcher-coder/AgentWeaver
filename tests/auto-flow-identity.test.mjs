import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { resolveAutoFlow } = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-resolver.js")).href);
const {
  autoFlowIdentityForSelection,
  isConfigurableAutoConfigFlowId,
  isContinuableParentFlowId,
  isRestartArchivingFlowId,
} = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-identity.js")).href);

let tempDir;
let originalHome;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-flow-identity-"));
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

function writeProjectConfig(name, body) {
  const filePath = path.join(tempDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
}

describe("auto flow identity", () => {
  it("keeps legacy flow IDs for standard and simple presets", async () => {
    const standardSelection = { kind: "preset", preset: "standard" };
    const simpleSelection = { kind: "preset", preset: "simple" };

    const standard = autoFlowIdentityForSelection(
      standardSelection,
      await resolveAutoFlow(standardSelection, { cwd: tempDir, scopeKey: "ag-126@test" }),
    );
    const simple = autoFlowIdentityForSelection(
      simpleSelection,
      await resolveAutoFlow(simpleSelection, { cwd: tempDir, scopeKey: "ag-126@test" }),
    );

    assert.equal(standard.flowId, "auto-common");
    assert.equal(standard.selectedCommand, "auto-common");
    assert.equal(simple.flowId, "auto-simple");
    assert.equal(simple.selectedCommand, "auto-simple");
  });

  it("uses a non-colliding auto-config flow ID for named configurations", async () => {
    writeProjectConfig("backend-standard", [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: standard",
      "",
    ].join("\n"));
    const selection = { kind: "config", name: "backend-standard" };
    const resolved = await resolveAutoFlow(selection, { cwd: tempDir, scopeKey: "ag-126@test" });
    const identity = autoFlowIdentityForSelection(selection, resolved);

    assert.equal(identity.flowId, "auto-config:backend-standard");
    assert.equal(identity.selectedCommand, "auto-common");
    assert.equal(isConfigurableAutoConfigFlowId(identity.flowId), true);
    assert.equal(isRestartArchivingFlowId(identity.flowId), true);
    assert.equal(isContinuableParentFlowId(identity.flowId), true);
  });
});
