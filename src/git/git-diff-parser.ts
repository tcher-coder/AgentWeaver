import type { GitDiffHunk, GitDiffMode, GitDiffRow, GitFileDiff } from "./git-types.js";

type RawDiffRow =
  | { kind: "context"; leftLineNumber: number; rightLineNumber: number; text: string }
  | { kind: "add"; leftLineNumber: null; rightLineNumber: number; text: string }
  | { kind: "delete"; leftLineNumber: number; rightLineNumber: null; text: string };

type DiffHeaderMetadata = {
  originalPath?: string;
};

export type ParseGitDiffOptions = {
  mode: GitDiffMode;
  path: string;
  displayPath?: string;
  originalPath?: string;
};

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseHunkHeader(line: string): Omit<GitDiffHunk, "rows"> | null {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!match) {
    return null;
  }
  return {
    header: line,
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? "1"),
  };
}

function normalizeGitPath(value: string): string {
  return value.replace(/^"?[ab]\//, "").replace(/"$/, "");
}

function parseHeaderMetadata(lines: string[]): DiffHeaderMetadata {
  const metadata: DiffHeaderMetadata = {};
  for (const line of lines) {
    if (line.startsWith("rename from ")) {
      metadata.originalPath = normalizeGitPath(line.slice("rename from ".length));
    }
  }
  return metadata;
}

function isBinaryDiff(lines: string[]): boolean {
  return lines.some((line) => (
    /^Binary files .+ and .+ differ$/.test(line)
    || line === "GIT binary patch"
    || line.startsWith("literal ")
    || line.startsWith("delta ")
  ));
}

function pushPairedRows(rows: GitDiffRow[], deletes: RawDiffRow[], adds: RawDiffRow[]): void {
  const pairedCount = Math.min(deletes.length, adds.length);
  for (let index = 0; index < pairedCount; index += 1) {
    const left = deletes[index]!;
    const right = adds[index]!;
    rows.push({
      kind: "modify",
      leftLineNumber: left.leftLineNumber,
      rightLineNumber: right.rightLineNumber,
      leftText: left.text,
      rightText: right.text,
    });
  }
  for (let index = pairedCount; index < deletes.length; index += 1) {
    const row = deletes[index]!;
    rows.push({
      kind: "delete",
      leftLineNumber: row.leftLineNumber,
      rightLineNumber: null,
      leftText: row.text,
      rightText: "",
    });
  }
  for (let index = pairedCount; index < adds.length; index += 1) {
    const row = adds[index]!;
    rows.push({
      kind: "add",
      leftLineNumber: null,
      rightLineNumber: row.rightLineNumber,
      leftText: "",
      rightText: row.text,
    });
  }
}

function normalizeRows(rawRows: RawDiffRow[]): GitDiffRow[] {
  const rows: GitDiffRow[] = [];
  let index = 0;
  while (index < rawRows.length) {
    const current = rawRows[index]!;
    if (current.kind !== "delete") {
      rows.push(current.kind === "context"
        ? {
          kind: "context",
          leftLineNumber: current.leftLineNumber,
          rightLineNumber: current.rightLineNumber,
          leftText: current.text,
          rightText: current.text,
        }
        : {
          kind: "add",
          leftLineNumber: null,
          rightLineNumber: current.rightLineNumber,
          leftText: "",
          rightText: current.text,
        });
      index += 1;
      continue;
    }

    const deletes: RawDiffRow[] = [];
    while (rawRows[index]?.kind === "delete") {
      deletes.push(rawRows[index]!);
      index += 1;
    }
    const adds: RawDiffRow[] = [];
    while (rawRows[index]?.kind === "add") {
      adds.push(rawRows[index]!);
      index += 1;
    }
    if (adds.length > 0) {
      pushPairedRows(rows, deletes, adds);
    } else {
      pushPairedRows(rows, deletes, []);
    }
  }
  return rows;
}

export function parseGitDiffOutput(output: string, options: ParseGitDiffOptions): GitFileDiff {
  const lines = splitLines(output);
  const metadata = parseHeaderMetadata(lines);
  if (isBinaryDiff(lines)) {
    return {
      mode: options.mode,
      path: options.path,
      displayPath: options.displayPath ?? options.path,
      ...(options.originalPath ?? metadata.originalPath ? { originalPath: options.originalPath ?? metadata.originalPath } : {}),
      binary: true,
      tooLarge: false,
      empty: false,
      hunks: [],
      message: "Binary file diff is not displayed.",
    };
  }

  const hunks: GitDiffHunk[] = [];
  let current: (Omit<GitDiffHunk, "rows"> & { rawRows: RawDiffRow[] }) | null = null;
  let leftLine = 0;
  let rightLine = 0;

  function finishCurrent(): void {
    if (!current) {
      return;
    }
    hunks.push({
      header: current.header,
      oldStart: current.oldStart,
      oldLines: current.oldLines,
      newStart: current.newStart,
      newLines: current.newLines,
      rows: normalizeRows(current.rawRows),
    });
    current = null;
  }

  for (const line of lines) {
    const header = parseHunkHeader(line);
    if (header) {
      finishCurrent();
      current = { ...header, rawRows: [] };
      leftLine = header.oldStart;
      rightLine = header.newStart;
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    const marker = line[0] ?? "";
    const value = line.length > 0 ? line.slice(1) : "";
    if (marker === " ") {
      current.rawRows.push({ kind: "context", leftLineNumber: leftLine, rightLineNumber: rightLine, text: value });
      leftLine += 1;
      rightLine += 1;
    } else if (marker === "-") {
      current.rawRows.push({ kind: "delete", leftLineNumber: leftLine, rightLineNumber: null, text: value });
      leftLine += 1;
    } else if (marker === "+") {
      current.rawRows.push({ kind: "add", leftLineNumber: null, rightLineNumber: rightLine, text: value });
      rightLine += 1;
    }
  }
  finishCurrent();

  return {
    mode: options.mode,
    path: options.path,
    displayPath: options.displayPath ?? options.path,
    ...(options.originalPath ?? metadata.originalPath ? { originalPath: options.originalPath ?? metadata.originalPath } : {}),
    binary: false,
    tooLarge: false,
    empty: hunks.length === 0 || hunks.every((hunk) => hunk.rows.length === 0),
    hunks,
    ...(hunks.length === 0 ? { message: "No diff is available for this mode." } : {}),
  };
}

export function createSyntheticAddedDiff(input: {
  mode: GitDiffMode;
  path: string;
  displayPath?: string;
  content: string;
}): GitFileDiff {
  const lines = splitLines(input.content);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return {
    mode: input.mode,
    path: input.path,
    displayPath: input.displayPath ?? input.path,
    binary: false,
    tooLarge: false,
    empty: lines.length === 0,
    hunks: lines.length === 0
      ? []
      : [{
        header: `@@ -0,0 +1,${lines.length} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        rows: lines.map((line, index) => ({
          kind: "add",
          leftLineNumber: null,
          rightLineNumber: index + 1,
          leftText: "",
          rightText: line,
        })),
      }],
    ...(lines.length === 0 ? { message: "Untracked file is empty." } : {}),
  };
}
