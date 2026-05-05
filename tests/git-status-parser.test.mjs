import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { parsePorcelain } = await import(pathToFileURL(path.join(distRoot, "git/git-status-parser.js")).href);

describe("git status parser", () => {
  it("ignores branch header and returns clean output as no files", () => {
    assert.deepEqual(parsePorcelain("## main...origin/main\n"), []);
  });

  it("parses supported dirty states for the Web UI", () => {
    const files = parsePorcelain([
      "M  staged.ts",
      " M unstaged.ts",
      "?? untracked.ts",
      " D deleted.ts",
      "R  old.ts -> new.ts",
      "UU conflicted.ts",
      " M --option-like.ts",
    ].join("\n"));

    assert.deepEqual(files.map((file) => [file.path, file.originalPath, file.xy, file.staged, file.type]), [
      ["staged.ts", undefined, "M ", true, "modified"],
      ["unstaged.ts", undefined, " M", false, "modified"],
      ["untracked.ts", undefined, "??", false, "untracked"],
      ["deleted.ts", undefined, " D", false, "deleted"],
      ["new.ts", "old.ts", "R ", true, "renamed"],
      ["conflicted.ts", undefined, "UU", true, "conflicted"],
      ["--option-like.ts", undefined, " M", false, "modified"],
    ]);
  });

  it("unquotes paths and preserves rename origins", () => {
    const files = parsePorcelain('R  "old file.txt" -> "new\\040file.txt"\nM  "\\320\\277\\321\\200\\320\\270\\320\\262\\320\\265\\321\\202.txt"\n');

    assert.equal(files[0].originalPath, "old file.txt");
    assert.equal(files[0].path, "new file.txt");
    assert.equal(files[1].path, "привет.txt");
  });
});

