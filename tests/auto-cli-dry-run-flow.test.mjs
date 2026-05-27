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

function resolverArtifactPaths(issueKey) {
  const artifactsDir = path.join(tempDir, ".agentweaver", "scopes", scopeKeyForIssue(issueKey), ".artifacts");
  return [
    path.join(artifactsDir, "flow-config.yaml"),
    path.join(artifactsDir, "resolved-flow.json"),
    path.join(artifactsDir, "resolved-flow-summary.json"),
  ];
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-cli-dry-run-flow-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempDir, "home");
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("auto dry-run flow CLI", () => {
  it("previews the base generated auto flow without writing resolver artifacts", () => {
    const result = runCli(["auto", "--dry-run-flow", "AG-123"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Auto flow dry-run preview/);
    assert.match(result.stdout, /Source: base/);
    assert.match(result.stdout, /Execution target: generated/);
    assert.ok(result.stdout.indexOf("design review (design_review_loop)") < result.stdout.indexOf("implementation (implement)"));
    for (const filePath of resolverArtifactPaths("AG-123")) {
      assert.equal(existsSync(filePath), false, `${filePath} should not exist`);
    }
  });

  it("loads a project-level saved v2 config for preview", () => {
    const configPath = path.join(tempDir, ".agentweaver", "flow-configs", "backend-standard.yaml");
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, [
      "kind: auto-flow-config",
      "version: 2",
      "name: backend-standard",
      "slots:",
      "  designReview:",
      "    blocks: []",
      "",
    ].join("\n"), "utf8");

    const result = runCli(["auto", "--config", "backend-standard", "--dry-run-flow", "AG-123"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Source: project-config/);
    assert.doesNotMatch(result.stdout, /design review \(design_review_loop\)/);
    assert.match(result.stdout, new RegExp(configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects --preset and legacy auto commands", () => {
    const preset = runCli(["auto", "--preset", "simple", "AG-123"]);
    assert.notEqual(preset.status, 0);
    assert.match(preset.stderr, /--preset is unsupported/);

    for (const command of ["auto-common", "auto-simple", "auto-golang", "auto-common-guided"]) {
      const result = runCli([command, "AG-123"]);
      assert.notEqual(result.status, 0, command);
    }
  });

  it("documents the new flags in CLI help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /--preset/);
    assert.match(result.stdout, /auto \[--config <name>\]/);
    assert.match(result.stdout, /auto-status \[--config <name>\]/);
    assert.match(result.stdout, /--dry-run-flow/);
  });
});
