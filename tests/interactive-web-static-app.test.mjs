import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

class ClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return String(this.element.className || "").split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.values().includes(name);
  }

  add(...names) {
    const next = new Set(this.values());
    names.forEach((name) => next.add(name));
    this.element.className = Array.from(next).join(" ");
  }

  remove(...names) {
    const remove = new Set(names);
    this.element.className = this.values().filter((name) => !remove.has(name)).join(" ");
  }

  toggle(name, force) {
    const has = this.contains(name);
    const shouldAdd = force === undefined ? !has : Boolean(force);
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.eventListeners = new Map();
    this.className = "";
    this.id = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.scrollTop = 0;
    this.clientHeight = 100;
    this.scrollHeight = 100;
    this._textContent = "";
    this.classList = new ClassList(this);
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? new FakeTextNode(node) : node;
      child.parentNode = this;
      this.children.push(child);
      if (child.id && this.ownerDocument) {
        this.ownerDocument.byId.set(child.id, child);
      }
    }
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set innerHTML(value) {
    this._textContent = String(value || "");
    this.children = [];
  }

  get innerHTML() {
    return this.textContent;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") {
      this.id = stringValue;
      this.ownerDocument?.byId.set(stringValue, this);
    } else if (name === "class") {
      this.className = stringValue;
    } else if (name.startsWith("data-")) {
      this.dataset[dataName(name)] = stringValue;
    } else {
      this[name] = stringValue;
    }
  }

  getAttribute(name) {
    if (name === "id") return this.id;
    if (name === "class") return this.className;
    if (name.startsWith("data-")) return this.dataset[dataName(name)];
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "href") {
      delete this.href;
    }
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type) || [];
    for (const listener of listeners) {
      listener.call(this, event);
    }
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: "click", target: this, preventDefault() {} });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    walk(this, (node) => {
      if (node !== this && node instanceof FakeElement && matches(node, selector)) {
        results.push(node);
      }
    });
    return results;
  }
}

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() {
    this.byId = new Map();
    this.body = new FakeElement("body", this);
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  getElementById(id) {
    if (!this.byId.has(id)) {
      const element = new FakeElement("div", this);
      element.id = id;
      this.byId.set(id, element);
      this.body.append(element);
    }
    return this.byId.get(id);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function dataName(attribute) {
  return attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function walk(node, visit) {
  for (const child of node.children || []) {
    visit(child);
    walk(child, visit);
  }
}

function matches(element, selector) {
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  const dataMatch = selector.match(/^\[data-([a-z0-9-]+)="([^"]*)"\]$/i);
  if (dataMatch) {
    return element.dataset[dataName(`data-${dataMatch[1]}`)] === dataMatch[2];
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class MockWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.listeners = new Map();
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

function createResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function createHarness(fetchHandler, clipboard) {
  MockWebSocket.instances = [];
  const document = new FakeDocument();
  const fetchCalls = [];
  const context = {
    document,
    window: {
      location: { protocol: "http:", host: "127.0.0.1:4321" },
      CSS: { escape: (value) => String(value).replace(/["\\]/g, "\\$&") },
    },
    navigator: clipboard === undefined ? {} : { clipboard },
    WebSocket: MockWebSocket,
    URLSearchParams,
    URL,
    fetch: async (url) => {
      fetchCalls.push(String(url));
      return fetchHandler(String(url));
    },
    setTimeout,
    clearTimeout,
    console,
  };
  context.window.document = document;
  context.window.navigator = context.navigator;
  context.window.WebSocket = MockWebSocket;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.resolve("src/interactive/web/static/app.js"), "utf8"), context);
  return {
    document,
    fetchCalls,
    socket: MockWebSocket.instances[0],
    sendSnapshot(viewModel) {
      MockWebSocket.instances[0].emit("message", {
        data: JSON.stringify({ type: "snapshot", viewModel }),
      });
    },
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function artifact(overrides) {
  return {
    id: overrides.id,
    title: overrides.title,
    kind: overrides.kind ?? "json",
    role: overrides.role ?? "artifact",
    relativePath: overrides.relativePath,
    logicalKey: overrides.logicalKey ?? null,
    sizeBytes: overrides.sizeBytes ?? 0,
    phaseId: overrides.phaseId ?? null,
    runId: overrides.runId ?? "run-1",
    source: "manifest",
  };
}

function openViewModel(overrides = {}) {
  return {
    title: "AgentWeaver",
    flowItems: [],
    selectedFlowIndex: 0,
    artifactExplorer: {
      available: true,
      open: true,
      scopeKey: "ag-117",
      runId: "run-1",
      status: "completed",
      label: "Artifacts ready",
      artifactCount: 2,
      message: "The workflow completed and scope artifacts are available for review.",
      ...overrides,
    },
  };
}

function progressSnapshot(items, overrides = {}) {
  return {
    title: "AgentWeaver",
    header: "Progress test",
    statusText: "State: idle",
    flowItems: [],
    selectedFlowIndex: 0,
    progressTitle: "Current Flow",
    progressText: "plain text should not drive structured rendering",
    progress: {
      flow: {
        id: "progress-flow",
        label: "Structured Progress Flow",
      },
      items,
      anchorIndex: 1,
    },
    artifactExplorer: {
      available: false,
      open: false,
      scopeKey: null,
      runId: null,
      status: "unavailable",
      label: "Artifact Explorer",
      message: "",
    },
    ...overrides,
  };
}

function gitWorkspace(overrides = {}) {
  return {
    available: true,
    repositoryRoot: "/repo",
    branch: "main",
    detachedHead: false,
    clean: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 0,
    lastCommit: { hash: "abc1234567", shortHash: "abc1234", subject: "Initial", authoredAt: "2026-01-01" },
    changedFiles: [
      { path: "--option-like.ts", file: "--option-like.ts", xy: " M", indexStatus: " ", workTreeStatus: "M", staged: false, type: "modified" },
      { path: "new.ts", file: "new.ts", originalPath: "old.ts", originalFile: "old.ts", xy: "R ", indexStatus: "R", workTreeStatus: " ", staged: true, type: "renamed" },
    ],
    branches: [{ name: "main", current: true }, { name: "feature/ag-121", current: false }],
    remotes: [{ name: "origin" }],
    canPush: true,
    pushDisabledReason: null,
    warnings: [],
    error: null,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    selectedPaths: [],
    commitMessage: "",
    operation: { status: "idle" },
    ...overrides,
  };
}

describe("static Artifact Explorer app", () => {
  it("places Git Workspace where Task Summary used to render", () => {
    const html = readFileSync(path.resolve("src/interactive/web/static/index.html"), "utf8");
    const splitStart = html.indexOf('<div class="split-panels">');
    const splitEnd = html.indexOf('<section class="log-pane"', splitStart);
    assert.notEqual(splitStart, -1);
    assert.notEqual(splitEnd, -1);
    const splitPanels = html.slice(splitStart, splitEnd);

    assert.doesNotMatch(html, /Task Summary|Task summary|summary-text|summary-title/);
    assert.match(splitPanels, /aria-label="Progress"/);
    assert.match(splitPanels, /aria-label="Git Workspace"/);
    assert.doesNotMatch(splitPanels, /aria-label="Task summary"/);
    assert.ok(splitPanels.indexOf('aria-label="Progress"') < splitPanels.indexOf('aria-label="Git Workspace"'));
  });

  it("renders Git Workspace dirty state and sends typed Git actions", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-121", items: [] }));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace(),
    }));

    assert.match(harness.document.getElementById("git-summary").textContent, /Branch main/);
    assert.match(harness.document.getElementById("git-summary").textContent, /dirty/);
    assert.equal(harness.document.querySelectorAll(".git-file-row").length, 2);
    assert.match(harness.document.getElementById("git-files").textContent, /--option-like\.ts/);
    assert.match(harness.document.getElementById("git-files").textContent, /old\.ts -> new\.ts/);

    const checkbox = harness.document.querySelector('[data-path="--option-like.ts"]').querySelector("input");
    checkbox.checked = true;
    checkbox.dispatchEvent({ type: "change", target: checkbox });
    harness.document.getElementById("git-stage-button").click();
    assert.deepEqual(harness.socket.sent.at(-1), {
      type: "git.stage",
      paths: ["--option-like.ts"],
      actionId: harness.socket.sent.at(-1).actionId,
    });

    harness.document.getElementById("git-commit-message").value = "Commit from Web UI";
    harness.document.getElementById("git-commit-button").disabled = false;
    harness.document.getElementById("git-commit-button").click();
    assert.equal(harness.socket.sent.at(-1).type, "git.commit");
    assert.deepEqual(harness.socket.sent.at(-1).paths, ["--option-like.ts"]);
    assert.equal(harness.socket.sent.at(-1).message, "Commit from Web UI");
  });

  it("renders Git Workspace files as modified and untracked trees with group checkbox selection", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-122", items: [] }));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace({
        changedFiles: [
          { path: "src/app.ts", file: "src/app.ts", xy: " M", indexStatus: " ", workTreeStatus: "M", staged: false, type: "modified" },
          { path: "src/lib/util.ts", file: "src/lib/util.ts", xy: "D ", indexStatus: "D", workTreeStatus: " ", staged: true, type: "deleted" },
          { path: "notes/todo.md", file: "notes/todo.md", xy: "??", indexStatus: "?", workTreeStatus: "?", staged: false, type: "untracked" },
        ],
      }),
    }));

    const modifiedRoot = harness.document.querySelector('[data-git-root="modified"]');
    const untrackedRoot = harness.document.querySelector('[data-git-root="untracked"]');
    assert.ok(modifiedRoot);
    assert.ok(untrackedRoot);
    assert.equal(harness.document.querySelectorAll(".git-file-row").length, 3);
    assert.match(harness.document.getElementById("git-files").textContent, /src\/lib\/util\.ts/);

    const modifiedCheckbox = modifiedRoot.querySelector("input");
    modifiedCheckbox.checked = true;
    modifiedCheckbox.dispatchEvent({ type: "change", target: modifiedCheckbox });
    harness.document.getElementById("git-stage-button").click();
    assert.deepEqual(harness.socket.sent.at(-1).paths.slice().sort(), ["src/app.ts", "src/lib/util.ts"]);

    harness.document.getElementById("git-unstage-button").click();
    assert.deepEqual(harness.socket.sent.at(-1).paths.slice().sort(), ["src/app.ts", "src/lib/util.ts"]);

    const untrackedCheckbox = untrackedRoot.querySelector("input");
    assert.equal(untrackedCheckbox.checked, false);
  });

  it("opens Git Diff drawer from a changed file and maps mode controls to backend modes", async () => {
    const diff = {
      mode: "head",
      path: "--option-like.ts",
      displayPath: "--option-like.ts",
      binary: false,
      tooLarge: false,
      empty: false,
      hunks: [{
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        rows: [{ kind: "modify", leftLineNumber: 1, rightLineNumber: 1, leftText: "old", rightText: "new" }],
      }],
    };
    const harness = createHarness((url) => createResponse(diff));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace(),
    }));

    harness.document.querySelector(".git-diff-open").click();
    await flush();

    assert.equal(harness.document.getElementById("git-diff-drawer").hidden, false);
    assert.match(harness.fetchCalls[0], /\/__agentweaver\/api\/git\/diff\?path=--option-like\.ts&mode=head$/);
    assert.match(harness.document.getElementById("git-diff-body").textContent, /old/);
    assert.match(harness.document.getElementById("git-diff-body").textContent, /new/);

    harness.document.querySelector('[data-git-diff-mode="staged"]').click();
    await flush();
    assert.match(harness.fetchCalls.at(-1), /mode=staged$/);

    harness.document.querySelector('[data-git-diff-mode="worktree"]').click();
    await flush();
    assert.match(harness.fetchCalls.at(-1), /mode=worktree$/);

    harness.document.getElementById("git-diff-close-button").click();
    assert.equal(harness.document.getElementById("git-diff-drawer").hidden, true);
  });

  it("renders Git diff content with textContent and clear exceptional states", async () => {
    const previews = [
      {
        mode: "head",
        path: "new.ts",
        displayPath: "new.ts",
        binary: false,
        tooLarge: false,
        empty: false,
        hunks: [{
          header: "@@ -0,0 +1,1 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          rows: [{ kind: "add", leftLineNumber: null, rightLineNumber: 1, leftText: "", rightText: "<script>alert(1)</script>" }],
        }],
      },
      { mode: "head", path: "new.ts", displayPath: "new.ts", binary: true, tooLarge: false, empty: false, hunks: [], message: "Binary file diff is not displayed." },
      { mode: "head", path: "new.ts", displayPath: "new.ts", binary: false, tooLarge: true, empty: false, hunks: [], message: "Diff is too large to display." },
      { mode: "head", path: "new.ts", displayPath: "new.ts", binary: false, tooLarge: false, empty: true, hunks: [], message: "No diff is available for this mode." },
    ];
    let index = 0;
    const harness = createHarness(() => createResponse(previews[index++]));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace(),
    }));

    harness.document.querySelector(".git-diff-open").click();
    await flush();
    const body = harness.document.getElementById("git-diff-body");
    assert.match(body.textContent, /<script>alert\(1\)<\/script>/);
    assert.equal(body.querySelectorAll("script").length, 0);

    harness.document.querySelector('[data-git-diff-mode="staged"]').click();
    await flush();
    assert.match(body.textContent, /Binary file diff is not displayed/);

    harness.document.querySelector('[data-git-diff-mode="worktree"]').click();
    await flush();
    assert.match(body.textContent, /Diff is too large to display/);

    harness.document.querySelector('[data-git-diff-mode="head"]').click();
    await flush();
    assert.match(body.textContent, /No diff is available for this mode/);
  });

  it("disables Stage when selected Git files are already staged-only", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-123", items: [] }));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace({
        changedFiles: [
          { path: "src/staged.ts", file: "src/staged.ts", xy: "M ", indexStatus: "M", workTreeStatus: " ", staged: true, type: "modified" },
        ],
      }),
    }));

    const modifiedCheckbox = harness.document.querySelector('[data-git-root="modified"]').querySelector("input");
    modifiedCheckbox.checked = true;
    modifiedCheckbox.dispatchEvent({ type: "change", target: modifiedCheckbox });

    assert.equal(harness.document.getElementById("git-stage-button").disabled, true);
    assert.equal(harness.document.getElementById("git-unstage-button").disabled, false);
    assert.match(harness.document.getElementById("git-files").textContent, /staged/);
    assert.doesNotMatch(harness.document.getElementById("git-files").textContent, /\bdir\b/i);
    const stagedBadge = harness.document.querySelectorAll(".git-file-type").find((element) => element.classList.contains("staged"));
    assert.equal(stagedBadge.textContent, "staged");
  });

  it("renders clean Git Workspace and disabled no-remote push guidance", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-121", items: [] }));
    harness.sendSnapshot(progressSnapshot([], {
      gitWorkspace: gitWorkspace({
        clean: true,
        changedFiles: [],
        remotes: [],
        canPush: false,
        pushDisabledReason: "No Git remote is configured.",
      }),
    }));

    assert.match(harness.document.getElementById("git-summary").textContent, /clean/);
    assert.match(harness.document.getElementById("git-files").textContent, /No changed files/);
    assert.equal(harness.document.getElementById("git-push-button").disabled, true);
    assert.match(harness.document.getElementById("git-feedback").textContent, /No Git remote is configured/);
  });

  it("renders structured progress rows with status-specific classes instead of parsing progressText", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-120", items: [] }));
    harness.sendSnapshot(progressSnapshot([
      { kind: "group", label: "item 1", depth: 0, status: "done" },
      { kind: "phase", label: "implement", depth: 1, status: "running" },
      { kind: "step", label: "edit-ui", depth: 2, status: "pending" },
      { kind: "step", label: "old-step", depth: 2, status: "skipped" },
      { kind: "termination", label: "Flow completed successfully", detail: "Reason: completed", depth: 0, status: "done" },
    ], {
      progressText: "✓ parsed-done\n● parsed-running\n○ parsed-pending",
    }));

    const progress = harness.document.getElementById("progress-text");
    const rows = progress.querySelectorAll(".progress-row");
    assert.equal(progress.querySelector(".progress-flow").textContent, "Structured Progress Flow");
    assert.equal(rows.length, 5);
    assert.equal(rows[0].dataset.kind, "group");
    assert.equal(rows[0].dataset.status, "done");
    assert.equal(rows[0].classList.contains("status-done"), true);
    assert.equal(rows[1].classList.contains("status-running"), true);
    assert.equal(rows[1].getAttribute("aria-current"), "step");
    assert.equal(rows[2].classList.contains("status-pending"), true);
    assert.equal(rows[3].classList.contains("status-skipped"), true);
    assert.match(rows[4].textContent, /Reason: completed/);
    assert.doesNotMatch(progress.textContent, /parsed-running/);
  });

  it("keeps the plain text progress fallback compatible without status parsing", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-120", items: [] }));
    harness.sendSnapshot({
      title: "AgentWeaver",
      flowItems: [],
      selectedFlowIndex: 0,
      progressText: "✓ finished from text\n● active from text",
      artifactExplorer: { available: false, open: false, status: "unavailable", label: "Artifact Explorer", message: "" },
    });

    const progress = harness.document.getElementById("progress-text");
    assert.equal(progress.classList.contains("fallback"), true);
    assert.equal(progress.querySelectorAll(".progress-row").length, 0);
    assert.match(progress.textContent, /finished from text/);
    assert.equal(progress.classList.contains("status-done"), false);
    assert.equal(progress.classList.contains("status-running"), false);
  });

  it("updates progress row status classes across live snapshots while preserving scroll", () => {
    const harness = createHarness(() => createResponse({ scopeKey: "ag-120", items: [] }));
    harness.sendSnapshot(progressSnapshot([
      { kind: "phase", label: "implement", depth: 0, status: "pending" },
    ]));

    const progress = harness.document.getElementById("progress-text");
    progress.scrollTop = 37;
    harness.sendSnapshot(progressSnapshot([
      { kind: "phase", label: "implement", depth: 0, status: "running" },
    ]));
    let row = progress.querySelector(".progress-row");
    assert.equal(progress.scrollTop, 37);
    assert.equal(row.classList.contains("status-running"), true);

    harness.sendSnapshot(progressSnapshot([
      { kind: "phase", label: "implement", depth: 0, status: "done" },
    ]));
    row = progress.querySelector(".progress-row");
    assert.equal(progress.scrollTop, 37);
    assert.equal(row.classList.contains("status-done"), true);
  });

  it("renders grouped metadata and auto-previews the highest-priority useful artifact", async () => {
    const catalog = {
      scopeKey: "ag-117",
      groups: [
        {
          title: "Diagnostics",
          items: [artifact({
            id: "debug-log",
            title: "Debug Log",
            kind: "text",
            role: "diagnostic",
            relativePath: ".artifacts/debug.log",
            sizeBytes: 1024,
          })],
        },
        {
          title: "Design",
          items: [artifact({
            id: "design-output",
            title: "System Design",
            kind: "markdown",
            role: "design",
            relativePath: ".artifacts/design.md",
            sizeBytes: 2048,
          })],
        },
      ],
    };
    const harness = createHarness((url) => {
      if (url.includes("/preview")) {
        assert.match(url, /design-output\/preview\?scope=ag-117$/);
        return createResponse({
          content: "# Design\n\nDetails",
          truncated: true,
          loadedBytes: 512,
          sizeBytes: 2048,
          renderKind: "markdown",
          artifact: catalog.groups[1].items[0],
        });
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel());
    await flush();

    assert.match(harness.document.getElementById("artifact-meta").textContent, /Workflow completed\. 2 artifacts in scope\./);
    assert.deepEqual(harness.document.querySelectorAll(".artifact-group").map((group) => group.querySelector("h3").textContent), ["Diagnostics", "Design"]);
    assert.equal(harness.document.querySelector('[data-artifact-id="design-output"]').classList.contains("selected"), true);
    assert.equal(harness.document.getElementById("artifact-preview-text").querySelector("h1").textContent, "Design");
    assert.match(harness.document.getElementById("artifact-preview-text").textContent, /Preview truncated: loaded 512 B of 2 KB/);
    assert.match(harness.document.querySelector('[data-artifact-id="design-output"]').textContent, /markdown/);
    assert.match(harness.document.querySelector('[data-artifact-id="design-output"]').textContent, /2 KB/);
    assert.match(harness.document.querySelector('[data-artifact-id="design-output"]').textContent, /\.artifacts\/design\.md/);
  });

  it("supports manual selection, isolated preview errors, and encoded raw/download links", async () => {
    const catalog = {
      scopeKey: "ag-117",
      items: [
        artifact({ id: "plan", title: "Plan", role: "plan", relativePath: ".artifacts/plan.md" }),
        artifact({ id: "folder/item two", title: "QA", role: "qa", relativePath: ".artifacts/qa.md" }),
      ],
    };
    const harness = createHarness((url) => {
      if (url.includes("folder%2Fitem%20two/preview")) {
        return createResponse({ message: "Preview failed" }, false);
      }
      if (url.includes("/preview")) {
        return createResponse({ content: "Plan content", artifact: catalog.items[0] });
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel());
    await flush();
    harness.document.querySelector('[data-artifact-id="folder/item two"]').querySelector("button").click();
    await flush();

    assert.equal(harness.document.querySelector('[data-artifact-id="folder/item two"]').classList.contains("selected"), true);
    assert.match(harness.document.getElementById("artifact-preview-text").textContent, /Preview failed/);
    assert.match(harness.document.getElementById("artifact-open-raw-link").href, /folder%2Fitem%20two\/raw\?scope=ag-117$/);
    assert.match(harness.document.getElementById("artifact-download-link").href, /folder%2Fitem%20two\/download\?scope=ag-117$/);
  });

  it("renders nested artifact type groups and still selects current-run artifacts first", async () => {
    const oldReview = artifact({
      id: "review-old",
      title: "Review",
      role: "review",
      relativePath: "review-ag-117-1.md",
      runId: "old-run",
    });
    const currentReview = artifact({
      id: "review-current",
      title: "Review",
      role: "review",
      relativePath: "review-ag-117-2.md",
      runId: "run-1",
    });
    const catalog = {
      scopeKey: "ag-117",
      groups: [{
        title: "Review",
        items: [oldReview, currentReview],
        groups: [{
          title: "Review",
          items: [oldReview, currentReview],
        }],
      }],
    };
    const harness = createHarness((url) => {
      if (url.includes("/preview")) {
        assert.match(url, /review-current\/preview\?scope=ag-117$/);
        return createResponse({ content: "Current review", artifact: currentReview });
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel({ artifactCount: 2 }));
    await flush();

    assert.deepEqual(harness.document.querySelectorAll("h4").map((heading) => heading.textContent), ["Review"]);
    assert.equal(harness.document.querySelector('[data-artifact-id="review-current"]').classList.contains("selected"), true);
    assert.equal(harness.document.querySelectorAll('[data-artifact-id="review-old"]').length, 1);
    assert.equal(harness.document.querySelectorAll('[data-artifact-id="review-current"]').length, 1);
  });

  it("renders list failure and empty catalog states without clearing close behavior", async () => {
    const failed = createHarness(() => createResponse({ message: "Catalog failed" }, false));
    failed.sendSnapshot(openViewModel());
    await flush();
    assert.match(failed.document.getElementById("artifact-list").textContent, /Catalog failed/);
    failed.document.getElementById("artifact-toolbar-close-button").click();
    assert.equal(failed.socket.sent.at(-1).type, "artifactExplorer.close");

    const empty = createHarness(() => createResponse({ scopeKey: "ag-117", items: [] }));
    empty.sendSnapshot(openViewModel({ artifactCount: 0 }));
    await flush();
    assert.match(empty.document.getElementById("artifact-list").textContent, /No artifacts were found for the current scope/);
  });

  it("reports clipboard success, unsupported clipboard, rejected clipboard, and close/reopen actions", async () => {
    const writes = [];
    const catalog = {
      scopeKey: "ag-117",
      items: [artifact({ id: "design", title: "Design", role: "design", relativePath: ".artifacts/design.md" })],
    };
    const harness = createHarness((url) => {
      if (url.includes("/preview")) return createResponse({ content: "Design content", artifact: catalog.items[0] });
      return createResponse(catalog);
    }, { writeText: async (value) => writes.push(value) });

    harness.sendSnapshot(openViewModel({ artifactCount: 1 }));
    await flush();
    harness.document.getElementById("artifact-copy-reference-button").click();
    harness.document.getElementById("artifact-copy-content-button").click();
    await flush();
    assert.deepEqual(writes, [".artifacts/design.md", "Design content"]);
    assert.match(harness.document.getElementById("artifact-action-status").textContent, /Copied artifact preview content/);

    harness.sendSnapshot(openViewModel({ open: false, artifactCount: 1 }));
    assert.equal(harness.document.getElementById("artifact-open-button").hidden, false);
    harness.document.getElementById("artifact-open-button").click();
    assert.equal(harness.socket.sent.at(-1).type, "artifactExplorer.open");

    const unsupported = createHarness(() => createResponse(catalog));
    unsupported.sendSnapshot(openViewModel({ artifactCount: 1 }));
    await flush();
    unsupported.document.getElementById("artifact-copy-reference-button").click();
    assert.match(unsupported.document.getElementById("artifact-action-status").textContent, /Clipboard is not available/);

    const rejected = createHarness(() => createResponse(catalog), { writeText: async () => { throw new Error("denied"); } });
    rejected.sendSnapshot(openViewModel({ artifactCount: 1 }));
    await flush();
    rejected.document.getElementById("artifact-copy-reference-button").click();
    await flush();
    assert.match(rejected.document.getElementById("artifact-action-status").textContent, /Clipboard copy failed: denied/);
  });

  it("renders the supported Markdown subset without creating unsafe links or HTML elements", async () => {
    const catalog = {
      scopeKey: "ag-117",
      items: [artifact({
        id: "markdown",
        title: "Markdown",
        kind: "markdown",
        role: "design",
        relativePath: ".artifacts/markdown.md",
      })],
    };
    const markdown = [
      "# Title",
      "",
      "Paragraph with `code` and [safe](https://example.com/path).",
      "",
      "- Bullet",
      "- Second",
      "",
      "1. First",
      "2. Second",
      "",
      "```js",
      "<tag>",
      "```",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| one | two |",
      "",
      "<script>alert(1)</script>",
      "[bad](javascript:alert(1)) [data](data:text/html,x)",
    ].join("\n");
    const harness = createHarness((url) => {
      if (url.includes("/preview")) {
        return createResponse({
          content: markdown,
          truncated: false,
          loadedBytes: markdown.length,
          sizeBytes: markdown.length,
          renderKind: "markdown",
          artifact: catalog.items[0],
        });
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel({ artifactCount: 1 }));
    await flush();

    const preview = harness.document.getElementById("artifact-preview-text");
    assert.equal(preview.querySelector("h1").textContent, "Title");
    assert.match(preview.querySelector("p").textContent, /Paragraph with code and safe/);
    assert.equal(preview.querySelectorAll("ul").length, 1);
    assert.equal(preview.querySelectorAll("ol").length, 1);
    assert.equal(preview.querySelector("pre").textContent, "<tag>");
    assert.equal(preview.querySelectorAll("table").length, 1);
    assert.equal(preview.querySelectorAll("script").length, 0);
    assert.match(preview.textContent, /<script>alert\(1\)<\/script>/);

    const links = preview.querySelectorAll("a");
    assert.equal(links.length, 1);
    assert.equal(links[0].href, "https://example.com/path");
    assert.equal(links[0].target, "_blank");
    assert.equal(links[0].rel, "noopener noreferrer");
    assert.doesNotMatch(preview.textContent, /href=.*javascript/i);
  });

  it("supports JSON Pretty and Raw modes while falling back for invalid or truncated JSON", async () => {
    const valid = artifact({ id: "valid-json", title: "Valid JSON", kind: "json", role: "design", relativePath: ".artifacts/valid.json" });
    const invalid = artifact({ id: "invalid-json", title: "Invalid JSON", kind: "json", role: "qa", relativePath: ".artifacts/invalid.json" });
    const truncated = artifact({ id: "truncated-json", title: "Truncated JSON", kind: "json", role: "artifact", relativePath: ".artifacts/truncated.json", sizeBytes: 614400 });
    const catalog = { scopeKey: "ag-117", items: [valid, invalid, truncated] };
    const previews = new Map([
      ["valid-json", { content: "{\"b\":2,\"a\":1}", truncated: false, loadedBytes: 13, sizeBytes: 13, jsonParseSafe: true, renderKind: "json", artifact: valid }],
      ["invalid-json", { content: "{\"bad\":", truncated: false, loadedBytes: 7, sizeBytes: 7, jsonParseSafe: true, renderKind: "json", artifact: invalid }],
      ["truncated-json", { content: "{\"bad\":", truncated: true, loadedBytes: 524288, sizeBytes: 614400, jsonParseSafe: false, renderKind: "json", artifact: truncated }],
    ]);
    const harness = createHarness((url) => {
      if (url.includes("/preview")) {
        const id = decodeURIComponent(url.match(/artifacts\/(.+)\/preview/)[1]);
        return createResponse(previews.get(id));
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel({ artifactCount: 3 }));
    await flush();

    let preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /"b": 2/);
    assert.match(preview.textContent, /"a": 1/);
    preview.querySelectorAll("button").find((button) => button.textContent === "Raw").click();
    assert.match(preview.textContent, /\{"b":2,"a":1\}/);

    harness.document.querySelector('[data-artifact-id="invalid-json"]').querySelector("button").click();
    await flush();
    preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /JSON parse error:/);
    assert.match(preview.textContent, /\{"bad":/);

    harness.document.querySelector('[data-artifact-id="truncated-json"]').querySelector("button").click();
    await flush();
    preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /JSON Pretty is unavailable for truncated or unsafe previews/);
    assert.doesNotMatch(preview.textContent, /JSON parse error:/);
    assert.match(preview.textContent, /Preview truncated: loaded 512 KB of 600 KB/);
  });

  it("renders text, diff, binary, and unknown previews through the correct safe paths", async () => {
    const textItem = artifact({ id: "text", title: "Text", kind: "text", role: "design", relativePath: "note.txt" });
    const diffItem = artifact({ id: "diff", title: "Diff", kind: "diff", role: "qa", relativePath: "patch.diff" });
    const binaryItem = artifact({ id: "binary", title: "Binary", kind: "binary", role: "artifact", relativePath: "blob.bin", sizeBytes: 4 });
    const unknownItem = artifact({ id: "unknown", title: "Unknown", kind: "unknown", role: "artifact", relativePath: "payload.custom", sizeBytes: 9 });
    const catalog = { scopeKey: "ag-117", items: [textItem, diffItem, binaryItem, unknownItem] };
    const harness = createHarness((url) => {
      if (url.includes("text/preview")) {
        return createResponse({ content: "line 1\n  indented\n\nlong long line", truncated: false, loadedBytes: 32, sizeBytes: 32, renderKind: "text", artifact: textItem });
      }
      if (url.includes("diff/preview")) {
        return createResponse({ content: "diff --git a/a b/a\n+added\n", truncated: false, loadedBytes: 27, sizeBytes: 27, renderKind: "diff", artifact: diffItem });
      }
      if (url.includes("/preview")) {
        return createResponse({ message: "unsupported_preview" }, false);
      }
      return createResponse(catalog);
    });

    harness.sendSnapshot(openViewModel({ artifactCount: 4 }));
    await flush();

    let preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.querySelector("pre").textContent, /line 1\n  indented\n\nlong long line/);

    harness.document.querySelector('[data-artifact-id="diff"]').querySelector("button").click();
    await flush();
    preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /Diff preview/);
    assert.match(preview.querySelector("pre").textContent, /diff --git/);

    harness.document.querySelector('[data-artifact-id="binary"]').querySelector("button").click();
    await flush();
    preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /Binary artifact/);
    assert.match(preview.textContent, /blob\.bin/);
    assert.ok(!harness.fetchCalls.some((url) => url.includes("binary/preview")));

    harness.document.querySelector('[data-artifact-id="unknown"]').querySelector("button").click();
    await flush();
    preview = harness.document.getElementById("artifact-preview-text");
    assert.match(preview.textContent, /Preview unavailable/);
    assert.match(preview.textContent, /payload\.custom/);
    assert.ok(!harness.fetchCalls.some((url) => url.includes("unknown/preview")));
  });
});
