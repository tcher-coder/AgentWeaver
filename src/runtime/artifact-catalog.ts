import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { buildLogicalKeyForPayload, type ArtifactPayloadFamily } from "../artifact-manifest.js";
import {
  artifactIndexFile,
  artifactManifestSidecarPath,
  scopeArtifactsDir,
  scopeWorkspaceDir,
} from "../artifacts.js";
import type { ArtifactRegistry, PublishedArtifactRecord } from "./artifact-registry.js";

export type ArtifactCatalogSource = "manifest" | "scanner";
export type ArtifactRenderKind = "markdown" | "json" | "text" | "diff" | "binary" | "unknown";

export type ArtifactCatalogItem = {
  id: string;
  scopeKey: string;
  runId: string | null;
  logicalKey: string | null;
  title: string;
  relativePath: string;
  kind: ArtifactRenderKind;
  role: string;
  phaseId: string | null;
  stepId: string | null;
  schemaId: string | null;
  sizeBytes: number;
  updatedAt: string;
  isLatest: boolean;
  source: ArtifactCatalogSource;
};

export type ArtifactCatalogGroup = {
  phaseId: string;
  title: string;
  items: ArtifactCatalogItem[];
};

export type ArtifactCatalog = {
  scopeKey: string;
  items: ArtifactCatalogItem[];
  groups: ArtifactCatalogGroup[];
};

export type ListArtifactCatalogInput = {
  scopeKey: string;
  artifactRegistry: ArtifactRegistry;
};

type FileMetadata = {
  sizeBytes: number;
  updatedAt: string;
};

type RoleMapping = {
  prefix: string;
  role: string;
  title: string;
};

const UNCLASSIFIED_PHASE_ID = "unclassified";

const ROLE_MAPPINGS: RoleMapping[] = [
  { prefix: "bug-fix-design", role: "design", title: "Bug Fix Design" },
  { prefix: "bug-fix-plan", role: "plan", title: "Bug Fix Plan" },
  { prefix: "bug-analyze", role: "analysis", title: "Bug Analysis" },
  { prefix: "task-context", role: "context", title: "Task Context" },
  { prefix: "gitlab-diff", role: "diff", title: "GitLab Diff" },
  { prefix: "jira-description", role: "context", title: "Jira Description" },
  { prefix: "design", role: "design", title: "Design" },
  { prefix: "plan", role: "plan", title: "Plan" },
  { prefix: "review", role: "review", title: "Review" },
  { prefix: "qa", role: "qa", title: "QA Plan" },
  { prefix: "task", role: "summary", title: "Task Summary" },
];

const ROLE_ORDER = new Map<string, number>([
  ["context", 10],
  ["analysis", 20],
  ["design", 30],
  ["plan", 40],
  ["qa", 50],
  ["review", 60],
  ["diff", 70],
  ["summary", 80],
  ["artifact", 90],
]);

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".bin",
  ".bmp",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".tar",
  ".tgz",
  ".webp",
  ".zip",
]);

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizedAbsolutePath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

function isInsideDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function scopeRelativePath(scopeKey: string, payloadPath: string): string {
  const workspaceDir = normalizedAbsolutePath(scopeWorkspaceDir(scopeKey));
  const normalizedPayloadPath = normalizedAbsolutePath(payloadPath);
  if (!isInsideDirectory(workspaceDir, normalizedPayloadPath)) {
    return normalizePathSeparators(path.basename(normalizedPayloadPath));
  }
  const relativePath = path.relative(workspaceDir, normalizedPayloadPath);
  return normalizePathSeparators(relativePath || path.basename(normalizedPayloadPath));
}

function fileMetadata(filePath: string, fallbackIso: string): FileMetadata {
  try {
    const stats = statSync(filePath);
    return {
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      sizeBytes: 0,
      updatedAt: fallbackIso,
    };
  }
}

function cleanBaseName(value: string): string {
  const extension = path.extname(value);
  return extension ? value.slice(0, -extension.length) : value;
}

function stripScopeAndVersionSuffix(value: string, scopeKey: string): string {
  const escapedScope = scopeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`-${escapedScope}-iter-\\d+$`), "")
    .replace(new RegExp(`-${escapedScope}-\\d+$`), "")
    .replace(new RegExp(`-${escapedScope}$`), "")
    .replace(/-\d+$/, "");
}

function toTitleCase(value: string): string {
  return value
    .replace(/[/_.-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mappingForKey(logicalKeyOrPath: string): RoleMapping | null {
  const normalized = logicalKeyOrPath.replace(/^\.artifacts\//, "").replace(/^artifacts\//, "");
  const fileStem = cleanBaseName(path.posix.basename(normalized));
  const candidates = [normalized, fileStem];
  return ROLE_MAPPINGS.find((mapping) => (
    candidates.some((candidate) => candidate === mapping.prefix || candidate.startsWith(`${mapping.prefix}-`))
  )) ?? null;
}

export function inferArtifactRole(logicalKey: string | null, relativePath: string): string {
  const mapping = mappingForKey(logicalKey ?? relativePath);
  return mapping?.role ?? "artifact";
}

export function inferArtifactTitle(scopeKey: string, logicalKey: string | null, relativePath: string): string {
  const source = logicalKey ?? relativePath;
  const mapping = mappingForKey(source);
  if (mapping) {
    return mapping.title;
  }
  const stem = stripScopeAndVersionSuffix(cleanBaseName(path.posix.basename(normalizePathSeparators(source))), scopeKey);
  return toTitleCase(stem) || "Artifact";
}

function kindFromPayloadFamily(payloadFamily: ArtifactPayloadFamily | null | undefined): ArtifactRenderKind | null {
  if (payloadFamily === "markdown") {
    return "markdown";
  }
  if (payloadFamily === "structured-json" || payloadFamily === "helper-json") {
    return "json";
  }
  if (payloadFamily === "plain-text") {
    return "text";
  }
  if (payloadFamily === "opaque-file") {
    return "binary";
  }
  return null;
}

function kindFromSchemaId(schemaId: string | null | undefined): ArtifactRenderKind | null {
  if (!schemaId) {
    return null;
  }
  const normalized = schemaId.toLowerCase();
  if (normalized.includes("markdown")) {
    return "markdown";
  }
  if (normalized.includes("diff") || normalized.includes("patch")) {
    return "diff";
  }
  if (normalized.includes("text") || normalized.includes("log")) {
    return "text";
  }
  if (normalized.endsWith("/v1") || normalized.includes("json")) {
    return "json";
  }
  return null;
}

function kindFromExtension(filePath: string): ArtifactRenderKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".txt" || extension === ".log") {
    return "text";
  }
  if (extension === ".diff" || extension === ".patch") {
    return "diff";
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    return "binary";
  }
  return "unknown";
}

export function inferArtifactRenderKind(input: {
  payloadFamily?: ArtifactPayloadFamily | null;
  schemaId?: string | null;
  filePath: string;
}): ArtifactRenderKind {
  return kindFromPayloadFamily(input.payloadFamily)
    ?? kindFromSchemaId(input.schemaId)
    ?? kindFromExtension(input.filePath);
}

function projectManifestRecord(scopeKey: string, record: PublishedArtifactRecord): ArtifactCatalogItem {
  const manifest = record.manifest;
  const metadata = fileMetadata(manifest.payload_path, manifest.created_at);
  const relativePath = scopeRelativePath(scopeKey, manifest.payload_path);
  const logicalKey = record.logical_key || manifest.logical_key;
  return {
    id: record.artifact_id,
    scopeKey,
    runId: manifest.run_id,
    logicalKey,
    title: inferArtifactTitle(scopeKey, logicalKey, relativePath),
    relativePath,
    kind: inferArtifactRenderKind({
      payloadFamily: manifest.payload_family,
      schemaId: record.schema_id || manifest.schema_id,
      filePath: manifest.payload_path,
    }),
    role: inferArtifactRole(logicalKey, relativePath),
    phaseId: manifest.phase_id || null,
    stepId: manifest.step_id || null,
    schemaId: record.schema_id || manifest.schema_id || null,
    sizeBytes: metadata.sizeBytes,
    updatedAt: metadata.updatedAt,
    isLatest: record.is_latest,
    source: "manifest",
  };
}

function isExcludedDirectory(name: string): boolean {
  return name === "manifest-history" || name === "restart-archives";
}

function isRegistryTempFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return /\.tmp-[^/\\]+$/.test(baseName)
    || baseName.endsWith(".tmp")
    || baseName.endsWith(".temp")
    || baseName.endsWith(".swp")
    || baseName.endsWith("~");
}

function isInternalIndexFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return baseName === "artifact-index.json"
    || baseName === "artifact-registry-index.json"
    || baseName === "manifest-index.json"
    || baseName === "internal-index.json"
    || baseName === ".index.json";
}

function isExcludedCatalogPath(scopeKey: string, filePath: string): boolean {
  const normalizedPath = normalizedAbsolutePath(filePath);
  const workspaceDir = normalizedAbsolutePath(scopeWorkspaceDir(scopeKey));
  if (!isInsideDirectory(workspaceDir, normalizedPath)) {
    return true;
  }
  const relativePath = normalizePathSeparators(path.relative(workspaceDir, normalizedPath));
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "manifest-history" || segment === "restart-archives")) {
    return true;
  }
  if (normalizedPath === normalizedAbsolutePath(artifactIndexFile(scopeKey))) {
    return true;
  }
  if (normalizedPath.endsWith(".manifest.json") || normalizedPath === normalizedAbsolutePath(artifactManifestSidecarPath(normalizedPath))) {
    return true;
  }
  if (isInternalIndexFile(normalizedPath) || isRegistryTempFile(normalizedPath)) {
    return true;
  }
  return path.basename(normalizedPath) === ".DS_Store";
}

function scanRoot(scopeKey: string, rootDir: string, seenDirectories: Set<string>): string[] {
  const normalizedRoot = normalizedAbsolutePath(rootDir);
  const workspaceDir = normalizedAbsolutePath(scopeWorkspaceDir(scopeKey));
  if (!existsSync(normalizedRoot) || !isInsideDirectory(workspaceDir, normalizedRoot)) {
    return [];
  }

  const files: string[] = [];
  const queue = [normalizedRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const normalizedCurrent = normalizedAbsolutePath(current);
    if (seenDirectories.has(normalizedCurrent)) {
      continue;
    }
    seenDirectories.add(normalizedCurrent);

    let entries;
    try {
      entries = readdirSync(normalizedCurrent, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(normalizedCurrent, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!isExcludedDirectory(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }
      if (entry.isFile() && !isExcludedCatalogPath(scopeKey, fullPath)) {
        files.push(normalizedAbsolutePath(fullPath));
      }
    }
  }
  return files;
}

function scanScopeFiles(scopeKey: string): string[] {
  const seenDirectories = new Set<string>();
  const files = [
    ...scanRoot(scopeKey, scopeWorkspaceDir(scopeKey), seenDirectories),
    ...scanRoot(scopeKey, scopeArtifactsDir(scopeKey), seenDirectories),
  ];
  return [...new Set(files)].sort((left, right) => scopeRelativePath(scopeKey, left).localeCompare(scopeRelativePath(scopeKey, right)));
}

function projectScannedFile(scopeKey: string, filePath: string): ArtifactCatalogItem {
  const relativePath = scopeRelativePath(scopeKey, filePath);
  const logicalKey = buildLogicalKeyForPayload(scopeKey, filePath);
  const metadata = fileMetadata(filePath, new Date(0).toISOString());
  return {
    id: `scanner:${scopeKey}:${relativePath}`,
    scopeKey,
    runId: null,
    logicalKey,
    title: inferArtifactTitle(scopeKey, logicalKey, relativePath),
    relativePath,
    kind: inferArtifactRenderKind({ filePath }),
    role: inferArtifactRole(logicalKey, relativePath),
    phaseId: null,
    stepId: null,
    schemaId: null,
    sizeBytes: metadata.sizeBytes,
    updatedAt: metadata.updatedAt,
    isLatest: true,
    source: "scanner",
  };
}

function roleRank(role: string): number {
  return ROLE_ORDER.get(role) ?? 100;
}

function phaseSortKey(phaseId: string | null): string {
  return phaseId ?? UNCLASSIFIED_PHASE_ID;
}

function compareCatalogItems(left: ArtifactCatalogItem, right: ArtifactCatalogItem): number {
  const phaseComparison = phaseSortKey(left.phaseId).localeCompare(phaseSortKey(right.phaseId));
  if (phaseComparison !== 0) {
    return phaseComparison;
  }
  const roleComparison = roleRank(left.role) - roleRank(right.role);
  if (roleComparison !== 0) {
    return roleComparison;
  }
  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

export function groupArtifactCatalog(items: ArtifactCatalogItem[]): ArtifactCatalogGroup[] {
  const grouped = new Map<string, ArtifactCatalogItem[]>();
  for (const item of items) {
    const phaseId = item.phaseId ?? UNCLASSIFIED_PHASE_ID;
    const phaseItems = grouped.get(phaseId) ?? [];
    phaseItems.push(item);
    grouped.set(phaseId, phaseItems);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([phaseId, phaseItems]) => ({
      phaseId,
      title: phaseId === UNCLASSIFIED_PHASE_ID ? "Unclassified" : toTitleCase(phaseId),
      items: phaseItems.slice().sort(compareCatalogItems),
    }));
}

export function listArtifactCatalog(input: ListArtifactCatalogInput): ArtifactCatalog {
  const seenPayloadPaths = new Set<string>();
  const items: ArtifactCatalogItem[] = [];

  for (const record of input.artifactRegistry.listScopeArtifacts(input.scopeKey)) {
    const payloadPath = normalizedAbsolutePath(record.manifest.payload_path);
    seenPayloadPaths.add(payloadPath);
    items.push(projectManifestRecord(input.scopeKey, record));
  }

  for (const filePath of scanScopeFiles(input.scopeKey)) {
    const normalizedPath = normalizedAbsolutePath(filePath);
    if (seenPayloadPaths.has(normalizedPath)) {
      continue;
    }
    seenPayloadPaths.add(normalizedPath);
    items.push(projectScannedFile(input.scopeKey, normalizedPath));
  }

  const sortedItems = items.slice().sort(compareCatalogItems);
  return {
    scopeKey: input.scopeKey,
    items: sortedItems,
    groups: groupArtifactCatalog(sortedItems),
  };
}
