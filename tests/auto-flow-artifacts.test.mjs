import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const {
  persistResolvedAutoFlowArtifacts,
  resolveAutoFlow,
} = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-resolver.js")).href);
const {
  flowConfigYamlFile,
  resolvedFlowJsonFile,
  resolvedFlowSummaryJsonFile,
} = await import(pathToFileURL(path.join(distRoot, "artifacts.js")).href);

let tempDir;
let originalCwd;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-flow-artifacts-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("auto flow resolver artifacts", () => {
  it("persists normalized config, resolved flow, and summary JSON", async () => {
    const scopeKey = "ag-123@test";
    const resolved = await resolveAutoFlow({ kind: "base" }, { cwd: tempDir, scopeKey });

    persistResolvedAutoFlowArtifacts(scopeKey, resolved);

    assert.equal(existsSync(flowConfigYamlFile(scopeKey)), true);
    assert.equal(existsSync(resolvedFlowJsonFile(scopeKey)), true);
    assert.equal(existsSync(resolvedFlowSummaryJsonFile(scopeKey)), true);
    const configYaml = readFileSync(flowConfigYamlFile(scopeKey), "utf8");
    assert.match(configYaml, /version: 2/);
    assert.doesNotMatch(configYaml, /basePreset/);

    const document = JSON.parse(readFileSync(resolvedFlowJsonFile(scopeKey), "utf8"));
    const summary = JSON.parse(readFileSync(resolvedFlowSummaryJsonFile(scopeKey), "utf8"));
    assert.equal(document.source.type, "base");
    assert.equal(document.executionTarget.kind, "generated");
    assert.equal("selectedCommand" in document, false);
    assert.equal(summary.fingerprint, document.fingerprint);
  });
});
