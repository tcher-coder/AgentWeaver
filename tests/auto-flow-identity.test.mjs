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
  isConfigurableAutoFlowId,
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
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

function writeProjectConfig(name) {
  const filePath = path.join(tempDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `kind: auto-flow-config\nversion: 2\nname: ${name}\n`, "utf8");
}

describe("auto flow identity", () => {
  it("uses immutable base identity for auto", async () => {
    const selection = { kind: "base" };
    const identity = autoFlowIdentityForSelection(
      selection,
      await resolveAutoFlow(selection, { cwd: tempDir, scopeKey: "ag-126@test" }),
    );

    assert.deepEqual(identity, {
      flowId: "auto",
      displayLabel: "Auto workflow",
      mutable: false,
    });
    assert.equal(isConfigurableAutoFlowId("auto"), true);
  });

  it("uses mutable auto-config flow IDs for named configurations", async () => {
    writeProjectConfig("backend-standard");
    const selection = { kind: "config", name: "backend-standard" };
    const resolved = await resolveAutoFlow(selection, { cwd: tempDir, scopeKey: "ag-126@test" });
    const identity = autoFlowIdentityForSelection(selection, resolved);

    assert.deepEqual(identity, {
      flowId: "auto-config:backend-standard",
      displayLabel: "config backend-standard",
      mutable: true,
    });
    assert.equal(isConfigurableAutoConfigFlowId(identity.flowId), true);
    assert.equal(isRestartArchivingFlowId(identity.flowId), true);
    assert.equal(isContinuableParentFlowId(identity.flowId), true);
  });

  it("rejects legacy public auto IDs as configurable IDs", () => {
    for (const flowId of ["auto-common", "auto-simple", "auto-golang", "auto-common-guided"]) {
      assert.equal(isConfigurableAutoFlowId(flowId), false, flowId);
    }
  });
});
