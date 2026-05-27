import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { resolveAutoFlow } = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-resolver.js")).href);
const { collectFlowRoutingGroups } = await import(pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href);

let tempDir;
let originalHome;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-flow-resolver-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempDir, "home");
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

function writeProjectConfig(name, body) {
  const filePath = path.join(tempDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
  return filePath;
}

describe("auto flow resolver", () => {
  it("resolves base auto as a generated flow in standard phase order", async () => {
    const resolved = await resolveAutoFlow({ kind: "base" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.execution.kind, "generated");
    assert.equal(resolved.document.executionTarget.kind, "generated");
    assert.equal("selectedCommand" in resolved.document, false);
    assert.equal("basePreset" in resolved.document, false);
    assert.deepEqual(resolved.document.phases.map((phase) => phase.id), [
      "source",
      "normalize",
      "plan",
      "design_review_loop",
      "implement",
      "review-loop",
    ]);
  });

  it("generates Go check phases from saved config slots", async () => {
    writeProjectConfig("backend-standard", [
      "kind: auto-flow-config",
      "version: 2",
      "name: backend-standard",
      "slots:",
      "  postImplementationChecks:",
      "    blocks:",
      "      - id: checks.go.linter",
      "        enabled: true",
      "      - id: checks.go.tests",
      "        enabled: true",
      "  final:",
      "    blocks:",
      "      - id: checks.go.linter",
      "        enabled: true",
      "      - id: checks.go.tests",
      "        enabled: true",
      "",
    ].join("\n"));

    const resolved = await resolveAutoFlow({ kind: "config", name: "backend-standard" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.deepEqual(resolved.document.phases.map((phase) => phase.id), [
      "source",
      "normalize",
      "plan",
      "design_review_loop",
      "implement",
      "post_go_linter_loop",
      "post_go_tests_loop",
      "review-loop",
      "final_go_linter_loop",
      "final_go_tests_loop",
    ]);
    assert.equal(resolved.document.executionTarget.flowSpec.phases.some((phase) => phase.id === "post_go_linter_loop"), true);
  });

  it("omits design review when a config explicitly overrides the slot without the default block", async () => {
    writeProjectConfig("no-design-review", [
      "kind: auto-flow-config",
      "version: 2",
      "name: no-design-review",
      "slots:",
      "  designReview:",
      "    blocks: []",
      "",
    ].join("\n"));

    const resolved = await resolveAutoFlow({ kind: "config", name: "no-design-review" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.document.phases.some((phase) => phase.id === "design_review_loop"), false);
    assert.ok(resolved.summary.skippedBlocks.some((block) => block.blockId === "review.design-loop"));
  });

  it("keeps fingerprints stable for identical input", async () => {
    const first = await resolveAutoFlow({ kind: "base" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    const second = await resolveAutoFlow({ kind: "base" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(first.document.fingerprint, second.document.fingerprint);
  });

  it("collects routing groups from generated in-memory nested flow-run nodes", async () => {
    const resolved = await resolveAutoFlow({ kind: "base" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    const groups = await collectFlowRoutingGroups(
      resolved.execution.flow,
      tempDir,
      new Set(),
      { inMemoryFlows: resolved.execution.inMemoryFlows },
    );

    assert.ok(groups.includes("design-review"));
    assert.ok(groups.includes("implementation"));
    assert.ok(groups.includes("repair-loop"));
  });
});
