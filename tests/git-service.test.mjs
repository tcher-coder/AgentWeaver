import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { createGitService } = await import(pathToFileURL(path.join(distRoot, "git/git-service.js")).href);
const { parseGitDiffOutput } = await import(pathToFileURL(path.join(distRoot, "git/git-diff-parser.js")).href);

function createRunner(responses = new Map()) {
  const calls = [];
  const runner = async (argv, options = {}) => {
    calls.push({ argv, options });
    const key = argv.join(" ");
    const response = responses.get(key);
    if (response instanceof Error) throw response;
    return response ?? "";
  };
  return { runner, calls };
}

function snapshot(overrides = {}) {
  return {
    available: true,
    repositoryRoot: "/repo",
    branch: "main",
    detachedHead: false,
    clean: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommit: null,
    changedFiles: [{ path: "--option-like.ts", file: "--option-like.ts", xy: " M", indexStatus: " ", workTreeStatus: "M", staged: false, type: "modified" }],
    branches: [],
    remotes: [],
    canPush: false,
    pushDisabledReason: "No Git remote is configured.",
    warnings: [],
    error: null,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    selectedPaths: [],
    commitMessage: "",
    operation: { status: "idle" },
    ...overrides,
  };
}

describe("git service", () => {
  it("builds a clean status snapshot and disables push without remotes", async () => {
    const responses = new Map([
      ["git -C /repo rev-parse --show-toplevel", "/repo\n"],
      ["git -C /repo status --porcelain --branch", "## main...origin/main [ahead 1, behind 2]\n"],
      ["git -C /repo branch --format=%(refname:short)%00%(HEAD)%00%(upstream:short)", "main\0*\0origin/main\n"],
      ["git -C /repo remote -v", ""],
      ["git -C /repo log -1 --format=%H%x00%h%x00%s%x00%ci", ["abc1234567", "abc1234", "Initial", "2026-01-01 00:00:00 +0000"].join("\0") + "\n"],
    ]);
    const { runner } = createRunner(responses);
    const service = createGitService({ cwd: "/repo", runCommand: runner });

    const result = await service.status();

    assert.equal(result.available, true);
    assert.equal(result.clean, true);
    assert.equal(result.branch, "main");
    assert.equal(result.ahead, 1);
    assert.equal(result.behind, 2);
    assert.equal(result.canPush, false);
    assert.match(result.pushDisabledReason, /No Git remote/);
  });

  it("passes selected option-like paths after -- for stage, unstage, and commit staging", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });
    const current = snapshot();

    await service.stage(["--option-like.ts"], current);
    await service.unstage(["--option-like.ts"], current);
    await service.commit(["--option-like.ts"], "commit option-like path", current);

    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "add", "-A", "--", "--option-like.ts"],
      ["git", "restore", "--staged", "--", "--option-like.ts"],
      ["git", "add", "-A", "--", "--option-like.ts"],
      ["git", "commit", "-m", "commit option-like path", "--", "--option-like.ts"],
    ]);
  });

  it("commits selected staged deletions without re-adding missing paths", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });
    const current = snapshot({
      changedFiles: [
        { path: "deleted.ts", file: "deleted.ts", xy: "D ", indexStatus: "D", workTreeStatus: " ", staged: true, type: "deleted" },
      ],
    });

    const result = await service.commit(["deleted.ts"], "commit deletion", current);

    assert.equal(result.status, "success");
    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "commit", "-m", "commit deletion", "--", "deleted.ts"],
    ]);
  });

  it("stages unstaged deletions with update-all semantics before committing", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });
    const current = snapshot({
      changedFiles: [
        { path: "deleted.ts", file: "deleted.ts", xy: " D", indexStatus: " ", workTreeStatus: "D", staged: false, type: "deleted" },
      ],
    });

    const result = await service.commit(["deleted.ts"], "commit deletion", current);

    assert.equal(result.status, "success");
    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "add", "-A", "--", "deleted.ts"],
      ["git", "commit", "-m", "commit deletion", "--", "deleted.ts"],
    ]);
  });

  it("rejects arbitrary paths and empty commit messages before invoking git", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });

    const invalidPath = await service.stage(["other.ts"], snapshot());
    const emptyCommit = await service.commit([], "   ", snapshot());

    assert.equal(invalidPath.status, "error");
    assert.match(invalidPath.message, /not in the current Git snapshot/);
    assert.equal(emptyCommit.status, "error");
    assert.match(emptyCommit.message, /must not be empty/);
    assert.equal(calls.length, 0);
  });

  it("rejects unsafe branch names before git mutation commands", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });

    for (const branchName of ["", " -bad", "-bad", "feature/../bad", "bad\nname"]) {
      const result = await service.createBranch(branchName);
      assert.equal(result.status, "error");
    }
    assert.equal(calls.length, 0);
  });

  it("uses git check-ref-format for branch validation before current-HEAD branch creation", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });

    const result = await service.createBranch("feature/ag-121");

    assert.equal(result.status, "success");
    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "check-ref-format", "--branch", "feature/ag-121"],
      ["git", "checkout", "-b", "feature/ag-121"],
    ]);
  });

  it("runs fetch, pull, and push in non-interactive mode without force arguments", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner, timeoutMs: 1000 });
    const pushable = snapshot({
      upstream: null,
      canPush: true,
      pushDisabledReason: null,
      remotes: [{ name: "origin", fetchUrl: "git@example/repo.git", pushUrl: "git@example/repo.git" }],
    });

    await service.fetch();
    await service.pullFfOnly();
    await service.push(pushable);

    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "fetch", "--prune"],
      ["git", "pull", "--ff-only"],
      ["git", "push", "--set-upstream", "origin", "main"],
    ]);
    for (const call of calls) {
      assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0");
      assert.equal(call.options.env.GCM_INTERACTIVE, "Never");
      assert.equal(call.argv.includes("--force"), false);
    }
  });

  it("surfaces non-interactive remote credential failures as operation errors", async () => {
    const failure = Object.assign(new Error("Command failed with exit code 128"), {
      output: "fatal: could not read Username for 'https://example.com': terminal prompts disabled",
    });
    const { runner, calls } = createRunner(new Map([
      ["git fetch --prune", failure],
    ]));
    const service = createGitService({ runCommand: runner, timeoutMs: 1000 });

    const result = await service.fetch();

    assert.equal(result.status, "error");
    assert.match(result.message, /terminal prompts disabled/);
    assert.equal(calls[0].options.env.GIT_TERMINAL_PROMPT, "0");
  });

  it("does not invoke git push when snapshot has no remote", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });

    const result = await service.push(snapshot());

    assert.equal(result.status, "error");
    assert.match(result.message, /No Git remote/);
    assert.equal(calls.length, 0);
  });

  it("builds safe diff commands for head, staged, and worktree modes", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });
    const current = snapshot();

    await service.diffFile("--option-like.ts", "head", current);
    await service.diffFile("--option-like.ts", "staged", current);
    await service.diffFile("--option-like.ts", "worktree", current);

    assert.deepEqual(calls.map((call) => call.argv), [
      ["git", "diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", "HEAD", "--", "--option-like.ts"],
      ["git", "diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", "--cached", "--", "--option-like.ts"],
      ["git", "diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", "--", "--option-like.ts"],
    ]);
  });

  it("rejects diff paths outside the current snapshot before invoking git", async () => {
    const { runner, calls } = createRunner();
    const service = createGitService({ runCommand: runner });

    await assert.rejects(
      () => service.diffFile("../outside.ts", "head", snapshot()),
      /not in the current Git snapshot/,
    );
    assert.equal(calls.length, 0);
  });

  it("parses unified diff hunks into side-by-side rows with modify pairing", () => {
    const diff = parseGitDiffOutput([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,4 +1,5 @@",
      " keep",
      "-old",
      "+new",
      "+added",
      " tail",
      "",
    ].join("\n"), { mode: "head", path: "src/app.ts" });

    assert.equal(diff.empty, false);
    assert.equal(diff.hunks.length, 1);
    assert.deepEqual(diff.hunks[0].rows.map((row) => row.kind), ["context", "modify", "add", "context"]);
    assert.equal(diff.hunks[0].rows[1].leftText, "old");
    assert.equal(diff.hunks[0].rows[1].rightText, "new");
    assert.equal(diff.hunks[0].rows[2].rightLineNumber, 3);
  });

  it("detects binary and rename metadata in parsed diffs", () => {
    const diff = parseGitDiffOutput([
      "diff --git a/old.bin b/new.bin",
      "similarity index 100%",
      "rename from old.bin",
      "rename to new.bin",
      "Binary files a/old.bin and b/new.bin differ",
    ].join("\n"), { mode: "head", path: "new.bin" });

    assert.equal(diff.binary, true);
    assert.equal(diff.originalPath, "old.bin");
    assert.deepEqual(diff.hunks, []);
  });

  it("synthesizes untracked text diffs and handles staged empty state", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentweaver-git-diff-"));
    try {
      mkdirSync(path.join(root, "src"));
      writeFileSync(path.join(root, "src", "new.ts"), "one\ntwo\n", "utf8");
      const service = createGitService({ cwd: root, runCommand: async () => "" });
      const current = snapshot({
        repositoryRoot: root,
        changedFiles: [{ path: "src/new.ts", file: "src/new.ts", xy: "??", indexStatus: "?", workTreeStatus: "?", staged: false, type: "untracked" }],
      });

      const diff = await service.diffFile("src/new.ts", "worktree", current);
      assert.equal(diff.empty, false);
      assert.deepEqual(diff.hunks[0].rows.map((row) => [row.leftText, row.rightText]), [["", "one"], ["", "two"]]);

      const staged = await service.diffFile("src/new.ts", "staged", current);
      assert.equal(staged.empty, true);
      assert.match(staged.message, /no staged diff/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects untracked symlink escapes and suppresses binary or too-large row payloads", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentweaver-git-diff-"));
    const outside = mkdtempSync(path.join(os.tmpdir(), "agentweaver-git-diff-outside-"));
    try {
      writeFileSync(path.join(outside, "secret.txt"), "secret\n", "utf8");
      symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
      writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2]));
      writeFileSync(path.join(root, "large.txt"), "x".repeat(32), "utf8");
      const service = createGitService({ cwd: root, runCommand: async () => "", maxDiffBytes: 8 });
      const current = snapshot({
        repositoryRoot: root,
        changedFiles: [
          { path: "escape.txt", file: "escape.txt", xy: "??", indexStatus: "?", workTreeStatus: "?", staged: false, type: "untracked" },
          { path: "blob.bin", file: "blob.bin", xy: "??", indexStatus: "?", workTreeStatus: "?", staged: false, type: "untracked" },
          { path: "large.txt", file: "large.txt", xy: "??", indexStatus: "?", workTreeStatus: "?", staged: false, type: "untracked" },
        ],
      });

      await assert.rejects(() => service.diffFile("escape.txt", "head", current), /escapes the repository root/);
      const binary = await service.diffFile("blob.bin", "head", current);
      assert.equal(binary.binary, true);
      assert.deepEqual(binary.hunks, []);
      const large = await service.diffFile("large.txt", "head", current);
      assert.equal(large.tooLarge, true);
      assert.deepEqual(large.hunks, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
