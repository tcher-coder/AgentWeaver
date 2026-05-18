import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const distIndex = path.resolve(process.cwd(), "dist/index.js");

let tempDir;
let originalHome;

function scopeKeyForIssue(issueKey) {
  const hash = crypto.createHash("sha1").update(tempDir).digest("hex").slice(0, 8);
  return `${issueKey.toLowerCase()}@${hash}`;
}

function artifactsDir(issueKey) {
  return path.join(tempDir, ".agentweaver", "scopes", scopeKeyForIssue(issueKey), ".artifacts");
}

function stateFile(issueKey, flowId) {
  return path.join(artifactsDir(issueKey), `.agentweaver-flow-state-${encodeURIComponent(flowId)}.json`);
}

function writeState(issueKey, flowId, overrides = {}) {
  const scopeKey = scopeKeyForIssue(issueKey);
  const filePath = stateFile(issueKey, flowId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 3,
    flowId,
    scopeKey,
    jiraRef: issueKey,
    status: "blocked",
    currentStep: "plan:run_plan",
    updatedAt: "2026-05-09T00:00:00.000Z",
    continuation: {
      continueEligible: false,
    },
    executionState: {
      flowKind: "auto-flow",
      flowVersion: 1,
      terminated: false,
      terminationOutcome: "success",
      phases: [],
    },
    ...overrides,
  }, null, 2)}\n`, "utf8");
}

function writeProjectConfig(name) {
  const configPath = path.join(tempDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, [
    "kind: auto-flow-config",
    "version: 1",
    `name: ${name}`,
    "basePreset: standard",
    "",
  ].join("\n"), "utf8");
}

function runCli(args) {
  return spawnSync("node", [distIndex, ...args], {
    cwd: tempDir,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      HOME: process.env.HOME,
      CODEX_BIN: "/bin/echo",
      OPENCODE_BIN: "/bin/echo",
      JIRA_BASE_URL: "https://jira.example.test",
    },
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-status-reset-"));
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

describe("configurable auto status and reset CLI", () => {
  it("auto-status defaults to auto-common and simple status ignores auto-golang state", () => {
    const issueKey = "AG-126";
    writeState(issueKey, "auto-common");
    writeState(issueKey, "auto-simple");
    const autoGolangStateFile = stateFile(issueKey, "auto-golang");
    mkdirSync(path.dirname(autoGolangStateFile), { recursive: true });
    writeFileSync(autoGolangStateFile, "{not-json", "utf8");

    const standard = runCli(["auto-status", issueKey]);
    assert.equal(standard.status, 0, standard.stderr);
    assert.match(standard.stdout, /Effective flow ID: auto-common/);
    assert.match(standard.stdout, /Status: blocked/);

    const simple = runCli(["auto-status", "--preset", "simple", issueKey]);
    assert.equal(simple.status, 0, simple.stderr);
    assert.match(simple.stdout, /Effective flow ID: auto-simple/);
    assert.match(simple.stdout, /Target: simple preset/);
  });

  it("auto-status re-resolves named configs and reads auto-config state", () => {
    const issueKey = "AG-126";
    writeProjectConfig("backend-standard");
    writeState(issueKey, "auto-config:backend-standard");

    const result = runCli(["auto-status", "--config", "backend-standard", issueKey]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Effective flow ID: auto-config:backend-standard/);
    assert.match(result.stdout, /Source: project-config backend-standard/);
    assert.match(result.stdout, /Status: blocked/);
  });

  it("auto-reset removes only the selected named-config state and preserves resolver artifacts", () => {
    const issueKey = "AG-126";
    writeProjectConfig("backend-standard");
    writeState(issueKey, "auto-common");
    writeState(issueKey, "auto-simple");
    writeState(issueKey, "auto-golang");
    writeState(issueKey, "auto-config:backend-standard");
    const artifactDir = artifactsDir(issueKey);
    writeFileSync(path.join(artifactDir, "flow-config.yaml"), "kind: auto-flow-config\n", "utf8");
    writeFileSync(path.join(artifactDir, "resolved-flow.json"), "{}\n", "utf8");
    writeFileSync(path.join(artifactDir, "resolved-flow-summary.json"), "{}\n", "utf8");

    const result = runCli(["auto-reset", "--config", "backend-standard", issueKey]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(stateFile(issueKey, "auto-config:backend-standard")), false);
    assert.equal(existsSync(stateFile(issueKey, "auto-common")), true);
    assert.equal(existsSync(stateFile(issueKey, "auto-simple")), true);
    assert.equal(existsSync(stateFile(issueKey, "auto-golang")), true);
    assert.equal(existsSync(path.join(artifactDir, "flow-config.yaml")), true);
    assert.equal(existsSync(path.join(artifactDir, "resolved-flow.json")), true);
    assert.equal(existsSync(path.join(artifactDir, "resolved-flow-summary.json")), true);
  });

  it("rejects invalid selector combinations on status and reset", () => {
    const status = runCli(["auto-status", "--preset", "simple", "--config", "backend-standard", "AG-126"]);
    assert.notEqual(status.status, 0);
    assert.match(status.stderr, /--preset and --config are mutually exclusive/);

    const reset = runCli(["auto-reset", "--preset", "wide", "AG-126"]);
    assert.notEqual(reset.status, 0);
    assert.match(reset.stderr, /--preset accepts only 'simple' or 'standard'/);
  });
});
