import type { GitChangedFile, GitChangedFileType } from "./git-types.js";

export function unquoteGitPath(s: string): string {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') {
    return s;
  }
  const inner = s.slice(1, -1);
  const decoder = new TextDecoder();
  let result = "";
  const byteBuf: number[] = [];
  const flushBytes = () => {
    if (byteBuf.length > 0) {
      result += decoder.decode(new Uint8Array(byteBuf));
      byteBuf.length = 0;
    }
  };

  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1]!;
      switch (next) {
        case "\\":
          flushBytes();
          result += "\\";
          i += 1;
          break;
        case '"':
          flushBytes();
          result += '"';
          i += 1;
          break;
        case "a":
          flushBytes();
          result += "\x07";
          i += 1;
          break;
        case "b":
          flushBytes();
          result += "\b";
          i += 1;
          break;
        case "f":
          flushBytes();
          result += "\f";
          i += 1;
          break;
        case "n":
          flushBytes();
          result += "\n";
          i += 1;
          break;
        case "r":
          flushBytes();
          result += "\r";
          i += 1;
          break;
        case "t":
          flushBytes();
          result += "\t";
          i += 1;
          break;
        case "v":
          flushBytes();
          result += "\v";
          i += 1;
          break;
        default:
          if (next >= "0" && next <= "7") {
            let octal = next;
            let consumed = 0;
            for (let j = 1; j <= 2 && i + 1 + j < inner.length; j += 1) {
              const ch = inner[i + 1 + j];
              if (ch !== undefined && ch >= "0" && ch <= "7") {
                octal += ch;
                consumed = j;
              } else {
                break;
              }
            }
            byteBuf.push(parseInt(octal, 8) & 0xff);
            i += 1 + consumed;
          } else {
            flushBytes();
            result += inner[i];
          }
      }
    } else {
      flushBytes();
      result += inner[i];
    }
  }
  flushBytes();
  return result;
}

export function splitRename(raw: string): { original: string; file: string } | null {
  let inQuote = false;
  for (let i = 0; i <= raw.length - 4; i += 1) {
    if (raw[i] === "\\" && inQuote) {
      i += 1;
      continue;
    }
    if (raw[i] === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && raw.slice(i, i + 4) === " -> ") {
      return { original: raw.slice(0, i), file: raw.slice(i + 4) };
    }
  }
  return null;
}

function classify(indexStatus: string, workTreeStatus: string): GitChangedFileType {
  if (indexStatus === "U" || workTreeStatus === "U" || (indexStatus === "A" && workTreeStatus === "A") || (indexStatus === "D" && workTreeStatus === "D")) {
    return "conflicted";
  }
  if (indexStatus === "A" || workTreeStatus === "A") {
    return "added";
  }
  if (indexStatus === "D" || workTreeStatus === "D") {
    return "deleted";
  }
  if (indexStatus === "R") {
    return "renamed";
  }
  if (indexStatus === "?" && workTreeStatus === "?") {
    return "untracked";
  }
  return "modified";
}

export function parsePorcelain(output: string): GitChangedFile[] {
  const lines = output.split(/\r?\n/);
  const files: GitChangedFile[] = [];

  for (const line of lines) {
    if (!line.trim() || line.startsWith("## ")) {
      continue;
    }

    const xy = line.slice(0, 2);
    const rawFile = line.slice(3);
    const indexStatus = xy[0] ?? " ";
    const workTreeStatus = xy[1] ?? " ";
    const staged = indexStatus !== " " && indexStatus !== "?";
    const type = classify(indexStatus, workTreeStatus);

    let file: string;
    let originalFile: string | undefined;
    if (indexStatus === "R" || indexStatus === "C") {
      const parts = splitRename(rawFile);
      if (parts) {
        originalFile = unquoteGitPath(parts.original);
        file = unquoteGitPath(parts.file);
      } else {
        file = unquoteGitPath(rawFile);
      }
    } else {
      file = unquoteGitPath(rawFile);
    }

    files.push({
      xy,
      indexStatus,
      workTreeStatus,
      file,
      ...(originalFile !== undefined ? { originalFile } : {}),
      path: file,
      ...(originalFile !== undefined ? { originalPath: originalFile } : {}),
      staged,
      type,
    });
  }

  return files;
}

