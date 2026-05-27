import type { FlowTreeFolderNode, FlowTreeNode, InteractiveFlowDefinition, VisibleFlowTreeItem } from "./types.js";
import {
  BUILT_IN_BLOCKS_ROOT,
  CUSTOM_ROOT,
  RECOMMENDED_ROOT,
  builtInFlowCatalogMetadata,
  catalogPathOrder,
  treePathLabels,
  treeSegmentLabel,
} from "../pipeline/flow-catalog-groups.js";

function compareTreeNames(left: string, right: string): number {
  return left.localeCompare(right, "ru");
}

function flowTreeLabel(flow: InteractiveFlowDefinition): string {
  return flow.source === "built-in"
    ? builtInFlowCatalogMetadata(flow.id)?.label ?? flow.label
    : flow.label;
}

function nodeOrder(node: FlowTreeNode): number | null {
  return catalogPathOrder(node.pathSegments, node.kind === "flow" ? node.flow.id : undefined);
}

function compareTreeNodes(left: FlowTreeNode, right: FlowTreeNode): number {
  const leftOrder = nodeOrder(left);
  const rightOrder = nodeOrder(right);
  if (leftOrder !== null || rightOrder !== null) {
    if (leftOrder === null) {
      return 1;
    }
    if (rightOrder === null) {
      return -1;
    }
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }

  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }
  return compareTreeNames(left.label, right.label);
}

export function makeFolderKey(pathSegments: string[]): string {
  return `folder:${pathSegments.join("/")}`;
}

export function makeFlowKey(flowId: string): string {
  return `flow:${flowId}`;
}

export function buildFlowTree(flows: InteractiveFlowDefinition[]): FlowTreeNode[] {
  const roots = new Map<string, FlowTreeFolderNode>();

  const ensureFolder = (pathSegments: string[]): FlowTreeFolderNode => {
    const firstSegment = pathSegments[0];
    if (!firstSegment) {
      throw new Error("Flow tree folder path cannot be empty.");
    }

    const rootFolder = roots.get(firstSegment);
    let currentFolder: FlowTreeFolderNode;
    if (rootFolder) {
      currentFolder = rootFolder;
    } else {
      currentFolder = {
        kind: "folder",
        key: makeFolderKey([firstSegment]),
        name: firstSegment,
        label: treeSegmentLabel(firstSegment),
        pathSegments: [firstSegment],
        children: [],
      };
      roots.set(firstSegment, currentFolder);
    }

    for (let index = 1; index < pathSegments.length; index += 1) {
      const segment = pathSegments[index] ?? "";
      const folderPath = pathSegments.slice(0, index + 1);
      let nextFolder = currentFolder.children.find(
        (child): child is FlowTreeFolderNode => child.kind === "folder" && child.name === segment,
      );
      if (!nextFolder) {
        nextFolder = {
          kind: "folder",
          key: makeFolderKey(folderPath),
          name: segment,
          label: treeSegmentLabel(segment),
          pathSegments: folderPath,
          children: [],
        };
        currentFolder.children.push(nextFolder);
      }
      currentFolder = nextFolder;
    }

    return currentFolder;
  };

  for (const flow of flows) {
    if (flow.treePath.length === 0) {
      continue;
    }
    const folderPath = flow.treePath.slice(0, -1);
    const leafName = flow.treePath[flow.treePath.length - 1] ?? flow.id;
    const parent = ensureFolder(folderPath);
    parent.children.push({
      kind: "flow",
      key: makeFlowKey(flow.id),
      name: leafName,
      label: flowTreeLabel(flow),
      pathSegments: [...flow.treePath],
      flow,
    });
  }

  const sortNodes = (nodes: FlowTreeNode[]): FlowTreeNode[] =>
    [...nodes]
      .sort(compareTreeNodes)
      .map((node) =>
        node.kind === "folder"
          ? {
              ...node,
              children: sortNodes(node.children),
            }
          : node,
      );

  return sortNodes([...roots.values()]);
}

export function computeVisibleFlowItems(
  flowTree: FlowTreeNode[],
  expandedFlowFolders: ReadonlySet<string>,
): VisibleFlowTreeItem[] {
  const items: VisibleFlowTreeItem[] = [];

  const walk = (nodes: FlowTreeNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind === "folder") {
        items.push({
          kind: "folder",
          key: node.key,
          name: node.name,
          label: node.label,
          depth,
          pathSegments: [...node.pathSegments],
        });
        if (expandedFlowFolders.has(node.key)) {
          walk(node.children, depth + 1);
        }
        continue;
      }

      items.push({
        kind: "flow",
        key: node.key,
        name: node.name,
        label: node.label,
        depth,
        pathSegments: [...node.pathSegments],
        flow: node.flow,
      });
    }
  };

  walk(flowTree, 0);
  return items;
}

export function collectFolderKeys(flowTree: FlowTreeNode[]): string[] {
  const keys: string[] = [];

  const walk = (nodes: FlowTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "folder") {
        continue;
      }
      keys.push(node.key);
      walk(node.children);
    }
  };

  walk(flowTree);
  return keys;
}

export function collectInitiallyExpandedFolderKeys(flowTree: FlowTreeNode[]): string[] {
  const keys: string[] = [];

  const folderContainsFlow = (node: FlowTreeFolderNode): boolean =>
    node.children.some((child) => child.kind === "flow" || folderContainsFlow(child));

  const walk = (nodes: FlowTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "folder") {
        continue;
      }
      const expandedByDefault =
        node.pathSegments.length === 1
        && (
          node.name === RECOMMENDED_ROOT
          || (node.name === CUSTOM_ROOT && folderContainsFlow(node))
        );
      if (expandedByDefault) {
        keys.push(node.key);
      }
      walk(node.children);
    }
  };

  walk(flowTree);
  return keys;
}

export function formatFlowTreePath(pathSegments: readonly string[]): string {
  return treePathLabels(pathSegments).join("/");
}

export function isBuiltInBlocksPath(pathSegments: readonly string[]): boolean {
  return pathSegments[0] === BUILT_IN_BLOCKS_ROOT;
}
