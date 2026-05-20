(function () {
  "use strict";

  var AUTO_FLOW_HEIGHT_DEFAULT = 520;
  var AUTO_FLOW_HEIGHT_MIN = 120;
  var AUTO_FLOW_HEIGHT_MAX = 640;
  var AUTO_FLOW_LOWER_PANELS_MIN = 180;
  var WORKSPACE_SPLIT_DEFAULT = 36;
  var WORKSPACE_SPLIT_MIN = 24;
  var WORKSPACE_SPLIT_MAX = 58;
  var autoFlowResizeDrag = null;
  var workspaceResizeDrag = null;

  var state = {
    viewModel: null,
    connectionState: "connecting",
    theme: "light",
    autoFlowHeight: null,
    workspaceSplit: WORKSPACE_SPLIT_DEFAULT,
    logAutoscroll: true,
    formId: null,
    formValues: {},
    gitChangedFilesSignature: null,
    modalSignature: null,
    renderSignatures: {
      autoFlow: null,
      artifact: null,
      flows: null,
      git: null,
      help: null,
      progress: null,
    },
    artifacts: {
      signature: null,
      loading: false,
      catalog: null,
      error: null,
      preview: null,
      selectedId: null,
      actionStatus: null,
      actionStatusFailed: false,
      previewRequestId: 0,
      viewerModes: {},
    },
    gitSelectedPaths: [],
    gitCommitMessage: "",
    gitDiff: {
      open: false,
      selectedPath: null,
      mode: "head",
      loading: false,
      error: null,
      diff: null,
      requestId: 0,
    },
    scrollSync: {
      suppress: false,
      releaseTimer: null,
      sentOffsets: {
        progress: null,
        log: null,
        help: null,
      },
    },
  };

  var elements = {
    title: document.getElementById("app-title"),
    header: document.getElementById("header-text"),
    connection: document.getElementById("connection-state"),
    status: document.getElementById("session-status"),
    run: document.getElementById("run-button"),
    interrupt: document.getElementById("interrupt-button"),
    help: document.getElementById("help-button"),
    themeToggle: document.getElementById("theme-toggle-button"),
    themeToggleLabel: document.getElementById("theme-toggle-label"),
    flowsTitle: document.getElementById("flows-title"),
    flows: document.getElementById("flows-list"),
    autoFlowEditor: document.getElementById("auto-flow-editor"),
    autoFlowResizer: document.getElementById("auto-flow-resizer"),
    splitPanels: document.getElementById("split-panels"),
    workspaceResizer: document.getElementById("workspace-resizer"),
    progressTitle: document.getElementById("progress-title"),
    progressFlowLabel: document.getElementById("progress-flow-label"),
    progress: document.getElementById("progress-text"),
    gitRefresh: document.getElementById("git-refresh-button"),
    gitSummary: document.getElementById("git-summary"),
    gitBranchInput: document.getElementById("git-branch-input"),
    gitCreateBranch: document.getElementById("git-create-branch-button"),
    gitCheckoutSelect: document.getElementById("git-checkout-select"),
    gitCheckout: document.getElementById("git-checkout-button"),
    gitFetch: document.getElementById("git-fetch-button"),
    gitPull: document.getElementById("git-pull-button"),
    gitFiles: document.getElementById("git-files"),
    gitCommitMessage: document.getElementById("git-commit-message"),
    gitStage: document.getElementById("git-stage-button"),
    gitUnstage: document.getElementById("git-unstage-button"),
    gitCommit: document.getElementById("git-commit-button"),
    gitPush: document.getElementById("git-push-button"),
    gitFeedback: document.getElementById("git-feedback"),
    gitDiffDrawer: document.getElementById("git-diff-drawer"),
    gitDiffClose: document.getElementById("git-diff-close-button"),
    gitDiffTitle: document.getElementById("git-diff-title"),
    gitDiffMeta: document.getElementById("git-diff-meta"),
    gitDiffStatus: document.getElementById("git-diff-status"),
    gitDiffFileList: document.getElementById("git-diff-file-list"),
    gitDiffSelectedTitle: document.getElementById("git-diff-selected-title"),
    gitDiffSelectedMeta: document.getElementById("git-diff-selected-meta"),
    gitDiffModeControls: document.getElementById("git-diff-mode-controls"),
    gitDiffBody: document.getElementById("git-diff-body"),
    logTitle: document.getElementById("log-title"),
    log: document.getElementById("log-text"),
    logAutoscroll: document.getElementById("log-autoscroll-toggle"),
    clearLog: document.getElementById("clear-log-button"),
    artifactOpen: document.getElementById("artifact-open-button"),
    artifactDrawer: document.getElementById("artifact-drawer"),
    artifactClose: document.getElementById("artifact-close-button"),
    artifactTitle: document.getElementById("artifact-title"),
    artifactMeta: document.getElementById("artifact-meta"),
    artifactMessage: document.getElementById("artifact-message"),
    artifactList: document.getElementById("artifact-list"),
    artifactSelectedTitle: document.getElementById("artifact-selected-title"),
    artifactSelectedMeta: document.getElementById("artifact-selected-meta"),
    artifactActionStatus: document.getElementById("artifact-action-status"),
    artifactCopyContent: document.getElementById("artifact-copy-content-button"),
    artifactCopyReference: document.getElementById("artifact-copy-reference-button"),
    artifactOpenRaw: document.getElementById("artifact-open-raw-link"),
    artifactDownload: document.getElementById("artifact-download-link"),
    artifactToolbarClose: document.getElementById("artifact-toolbar-close-button"),
    artifactPreview: document.getElementById("artifact-preview-text"),
    helpPanel: document.getElementById("help-panel"),
    helpText: document.getElementById("help-text"),
    closeHelp: document.getElementById("close-help-button"),
    modalRoot: document.getElementById("modal-root"),
  };

  function text(value, fallback) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    return fallback;
  }

  function normalizeTheme(value) {
    return value === "dark" ? "dark" : "light";
  }

  function isTheme(value) {
    return value === "dark" || value === "light";
  }

  function persistThemePreference(theme) {
    api.updateSettings({ theme: normalizeTheme(theme) });
  }

  function applyTheme(theme) {
    var nextTheme = normalizeTheme(theme);
    var root = document.documentElement || document.body;
    state.theme = nextTheme;
    if (root) {
      root.setAttribute("data-theme", nextTheme);
    }
    if (elements.themeToggle) {
      var dark = nextTheme === "dark";
      elements.themeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
      elements.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      elements.themeToggle.title = dark ? "Switch to light theme" : "Switch to dark theme";
    }
    if (elements.themeToggleLabel) {
      elements.themeToggleLabel.textContent = nextTheme === "dark" ? "Dark" : "Light";
    }
  }

  function toggleTheme() {
    var nextTheme = state.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    persistThemePreference(nextTheme);
  }

  function persistAutoFlowHeight(height) {
    var clamped = clampAutoFlowHeight(height);
    api.updateSettings({ autoFlowHeight: clamped });
  }

  function autoFlowHeightBounds() {
    var max = AUTO_FLOW_HEIGHT_MAX;
    var detailsPane = elements && elements.autoFlowEditor ? elements.autoFlowEditor.parentNode : null;
    if (detailsPane) {
      var rectHeight = typeof detailsPane.getBoundingClientRect === "function"
        ? detailsPane.getBoundingClientRect().height
        : 0;
      if (Number.isFinite(rectHeight) && rectHeight > AUTO_FLOW_HEIGHT_MIN + AUTO_FLOW_LOWER_PANELS_MIN) {
        max = Math.min(max, rectHeight - AUTO_FLOW_LOWER_PANELS_MIN);
      }
    }
    return {
      min: AUTO_FLOW_HEIGHT_MIN,
      max: Math.max(AUTO_FLOW_HEIGHT_MIN, max),
    };
  }

  function clampAutoFlowHeight(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    var bounds = autoFlowHeightBounds();
    return Math.min(bounds.max, Math.max(bounds.min, Math.round(numeric)));
  }

  function getAutoFlowEditorHeight() {
    if (!elements.autoFlowEditor) {
      return state.autoFlowHeight || AUTO_FLOW_HEIGHT_DEFAULT;
    }
    if (typeof elements.autoFlowEditor.getBoundingClientRect === "function") {
      var rect = elements.autoFlowEditor.getBoundingClientRect();
      if (rect && Number.isFinite(rect.height) && rect.height > 0) {
        return rect.height;
      }
    }
    var inlineHeight = parseInt(elements.autoFlowEditor.style.height || "", 10);
    return Number.isFinite(inlineHeight) ? inlineHeight : (state.autoFlowHeight || AUTO_FLOW_HEIGHT_DEFAULT);
  }

  function applyAutoFlowHeight(height) {
    if (!elements.autoFlowEditor) {
      return;
    }
    var clamped = clampAutoFlowHeight(height);
    if (clamped === null) {
      state.autoFlowHeight = null;
      elements.autoFlowEditor.style.height = "";
      updateAutoFlowResizerState(null);
      return;
    }
    state.autoFlowHeight = clamped;
    elements.autoFlowEditor.style.height = clamped + "px";
    updateAutoFlowResizerState(clamped);
  }

  function updateAutoFlowResizerState(currentHeight) {
    if (!elements.autoFlowResizer) {
      return;
    }
    var bounds = autoFlowHeightBounds();
    elements.autoFlowResizer.setAttribute("aria-valuemin", String(bounds.min));
    elements.autoFlowResizer.setAttribute("aria-valuemax", String(bounds.max));
    elements.autoFlowResizer.setAttribute("aria-valuenow", String(Math.round(currentHeight || getAutoFlowEditorHeight())));
  }

  function beginAutoFlowResize(event) {
    if (!elements.autoFlowEditor || elements.autoFlowEditor.hidden) {
      return;
    }
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    autoFlowResizeDrag = {
      startY: Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : 0,
      startHeight: getAutoFlowEditorHeight(),
    };
    document.body.classList.add("auto-flow-resizing");
    elements.autoFlowResizer.classList.add("resizing");
    if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a progressive enhancement for smoother dragging.
      }
    }
    window.addEventListener("pointermove", updateAutoFlowResize);
    window.addEventListener("pointerup", finishAutoFlowResize);
    window.addEventListener("pointercancel", finishAutoFlowResize);
  }

  function updateAutoFlowResize(event) {
    if (!autoFlowResizeDrag) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    var clientY = Number(event.clientY);
    if (!Number.isFinite(clientY)) {
      clientY = autoFlowResizeDrag.startY;
    }
    applyAutoFlowHeight(autoFlowResizeDrag.startHeight + clientY - autoFlowResizeDrag.startY);
  }

  function finishAutoFlowResize() {
    if (!autoFlowResizeDrag) {
      return;
    }
    autoFlowResizeDrag = null;
    document.body.classList.remove("auto-flow-resizing");
    elements.autoFlowResizer.classList.remove("resizing");
    persistAutoFlowHeight(state.autoFlowHeight);
    window.removeEventListener("pointermove", updateAutoFlowResize);
    window.removeEventListener("pointerup", finishAutoFlowResize);
    window.removeEventListener("pointercancel", finishAutoFlowResize);
  }

  function resetAutoFlowHeight() {
    applyAutoFlowHeight(null);
    persistAutoFlowHeight(null);
  }

  function handleAutoFlowResizerKeydown(event) {
    var step = event.shiftKey ? 48 : 20;
    var nextHeight = getAutoFlowEditorHeight();
    if (event.key === "ArrowUp") {
      nextHeight -= step;
    } else if (event.key === "ArrowDown") {
      nextHeight += step;
    } else if (event.key === "Home") {
      nextHeight = AUTO_FLOW_HEIGHT_MIN;
    } else if (event.key === "End") {
      nextHeight = AUTO_FLOW_HEIGHT_MAX;
    } else {
      return;
    }
    event.preventDefault();
    applyAutoFlowHeight(nextHeight);
    persistAutoFlowHeight(state.autoFlowHeight);
  }

  function persistWorkspaceSplit(split) {
    var nextSplit = Number.isFinite(split) ? clampWorkspaceSplit(split) : WORKSPACE_SPLIT_DEFAULT;
    api.updateSettings({ workspaceSplit: nextSplit });
  }

  function clampWorkspaceSplit(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return WORKSPACE_SPLIT_DEFAULT;
    }
    return Math.min(WORKSPACE_SPLIT_MAX, Math.max(WORKSPACE_SPLIT_MIN, Math.round(numeric)));
  }

  function applyWorkspaceSplit(split) {
    if (!elements.splitPanels) {
      return;
    }
    var clamped = clampWorkspaceSplit(split);
    state.workspaceSplit = clamped;
    if (elements.splitPanels.style && typeof elements.splitPanels.style.setProperty === "function") {
      elements.splitPanels.style.setProperty("--aw-work-panel-width", clamped + "%");
    } else if (elements.splitPanels.style) {
      elements.splitPanels.style["--aw-work-panel-width"] = clamped + "%";
    }
    updateWorkspaceResizerState(clamped);
  }

  function workspacePanelWidth() {
    if (!elements.splitPanels || typeof elements.splitPanels.getBoundingClientRect !== "function") {
      return 0;
    }
    var rect = elements.splitPanels.getBoundingClientRect();
    return rect && Number.isFinite(rect.width) ? rect.width : 0;
  }

  function updateWorkspaceResizerState(split) {
    if (!elements.workspaceResizer) {
      return;
    }
    elements.workspaceResizer.setAttribute("aria-valuemin", String(WORKSPACE_SPLIT_MIN));
    elements.workspaceResizer.setAttribute("aria-valuemax", String(WORKSPACE_SPLIT_MAX));
    elements.workspaceResizer.setAttribute("aria-valuenow", String(clampWorkspaceSplit(split)));
  }

  function beginWorkspaceResize(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    var width = workspacePanelWidth();
    if (width <= 0) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    workspaceResizeDrag = {
      startX: Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : 0,
      startSplit: state.workspaceSplit,
      width: width,
    };
    document.body.classList.add("workspace-split-resizing");
    elements.workspaceResizer.classList.add("resizing");
    if (event.currentTarget && typeof event.currentTarget.setPointerCapture === "function" && event.pointerId !== undefined) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is a progressive enhancement for smoother dragging.
      }
    }
    window.addEventListener("pointermove", updateWorkspaceResize);
    window.addEventListener("pointerup", finishWorkspaceResize);
    window.addEventListener("pointercancel", finishWorkspaceResize);
  }

  function updateWorkspaceResize(event) {
    if (!workspaceResizeDrag) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    var clientX = Number(event.clientX);
    if (!Number.isFinite(clientX)) {
      clientX = workspaceResizeDrag.startX;
    }
    var nextSplit = workspaceResizeDrag.startSplit + ((clientX - workspaceResizeDrag.startX) / workspaceResizeDrag.width) * 100;
    applyWorkspaceSplit(nextSplit);
  }

  function finishWorkspaceResize() {
    if (!workspaceResizeDrag) {
      return;
    }
    workspaceResizeDrag = null;
    document.body.classList.remove("workspace-split-resizing");
    elements.workspaceResizer.classList.remove("resizing");
    persistWorkspaceSplit(state.workspaceSplit);
    window.removeEventListener("pointermove", updateWorkspaceResize);
    window.removeEventListener("pointerup", finishWorkspaceResize);
    window.removeEventListener("pointercancel", finishWorkspaceResize);
  }

  function resetWorkspaceSplit() {
    applyWorkspaceSplit(WORKSPACE_SPLIT_DEFAULT);
    persistWorkspaceSplit(null);
  }

  function handleWorkspaceResizerKeydown(event) {
    var step = event.shiftKey ? 6 : 2;
    var nextSplit = state.workspaceSplit;
    if (event.key === "ArrowLeft") {
      nextSplit -= step;
    } else if (event.key === "ArrowRight") {
      nextSplit += step;
    } else if (event.key === "Home") {
      nextSplit = WORKSPACE_SPLIT_MIN;
    } else if (event.key === "End") {
      nextSplit = WORKSPACE_SPLIT_MAX;
    } else {
      return;
    }
    event.preventDefault();
    applyWorkspaceSplit(nextSplit);
    persistWorkspaceSplit(state.workspaceSplit);
  }

  function persistLogAutoscroll(enabled) {
    api.updateSettings({ logAutoscroll: Boolean(enabled) });
  }

  function applyLogAutoscroll(enabled) {
    state.logAutoscroll = Boolean(enabled);
    if (elements.logAutoscroll) {
      elements.logAutoscroll.checked = state.logAutoscroll;
    }
    if (state.logAutoscroll) {
      scrollLogToBottom();
    }
  }

  function applyWebUiSettings(settings) {
    if (!settings || typeof settings !== "object") {
      return;
    }
    if (isTheme(settings.theme)) {
      applyTheme(settings.theme);
    }
    if ("autoFlowHeight" in settings) {
      applyAutoFlowHeight(settings.autoFlowHeight);
    }
    if (Number.isFinite(Number(settings.workspaceSplit))) {
      applyWorkspaceSplit(settings.workspaceSplit);
    }
    if (typeof settings.logAutoscroll === "boolean") {
      applyLogAutoscroll(settings.logAutoscroll);
    }
  }

  function scrollLogToBottom() {
    if (!elements.log) {
      return;
    }
    elements.log.scrollTop = elements.log.scrollHeight;
    rememberScrollOffset("log", elements.log.scrollTop);
  }

  function actionId() {
    return "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function controlId(prefix) {
    var parts = Array.prototype.slice.call(arguments, 1).map(function (part) {
      return String(part || "")
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "value";
    });
    return [prefix].concat(parts).join("-");
  }

  function roundedScrollTop(element) {
    return Math.round(Number(element.scrollTop) || 0);
  }

  function rememberScrollOffset(pane, offset) {
    if (state.scrollSync.sentOffsets[pane] !== undefined) {
      state.scrollSync.sentOffsets[pane] = Math.round(Number(offset) || 0);
    }
  }

  function rememberCurrentScrollOffsets() {
    rememberScrollOffset("progress", elements.progress ? elements.progress.scrollTop : 0);
    rememberScrollOffset("log", elements.log ? elements.log.scrollTop : 0);
    rememberScrollOffset("help", elements.helpText ? elements.helpText.scrollTop : 0);
  }

  function releaseScrollSuppressionSoon() {
    if (state.scrollSync.releaseTimer) {
      clearTimeout(state.scrollSync.releaseTimer);
    }
    state.scrollSync.releaseTimer = setTimeout(function () {
      state.scrollSync.suppress = false;
      state.scrollSync.releaseTimer = null;
      rememberCurrentScrollOffsets();
    }, 0);
  }

  function sendScrollPane(pane, element) {
    if (state.scrollSync.suppress) {
      return;
    }
    var offset = roundedScrollTop(element);
    if (state.scrollSync.sentOffsets[pane] === offset) {
      return;
    }
    rememberScrollOffset(pane, offset);
    api.scrollPane(pane, offset);
  }

  function selectedFlow() {
    var vm = state.viewModel;
    if (!vm || !Array.isArray(vm.flowItems)) {
      return null;
    }
    return vm.flowItems[vm.selectedFlowIndex] || null;
  }

  function isFolder(item) {
    if (item && item.kind) {
      return item.kind === "folder";
    }
    var key = String(item && item.key ? item.key : "");
    var label = String(item && item.label ? item.label : "");
    return key.indexOf("folder:") === 0 || key.indexOf("folder/") === 0 || label.trim().endsWith("/");
  }

  function flowMeta(item) {
    var key = String(item && item.key ? item.key : "");
    if (key.indexOf("project") >= 0) return "project";
    if (key.indexOf("global") >= 0) return "global";
    if (key.indexOf("built") >= 0 || key.indexOf("default") >= 0) return "built-in";
    return key;
  }

  var api = {
    socket: null,
    send: function (message) {
      if (!message.actionId) {
        message.actionId = actionId();
      }
      if (!api.socket || api.socket.readyState !== WebSocket.OPEN) {
        appendLog("[web] Cannot send action while disconnected: " + message.type);
        return;
      }
      api.socket.send(JSON.stringify(message));
    },
    connect: function () {
      setConnection("connecting");
      var scheme = window.location.protocol === "https:" ? "wss://" : "ws://";
      api.socket = new WebSocket(scheme + window.location.host + "/__agentweaver/ws");
      api.socket.addEventListener("open", function () {
        setConnection("connected");
      });
      api.socket.addEventListener("close", function () {
        setConnection(state.connectionState === "closed" ? "closed" : "disconnected");
      });
      api.socket.addEventListener("error", function () {
        setConnection("error");
      });
      api.socket.addEventListener("message", function (event) {
        handleServerEvent(event.data);
      });
    },
    selectFlow: function (index, key) {
      api.send({ type: "flow.select", index: index, key: key });
    },
    toggleFolder: function (key) {
      api.send({ type: "folder.toggle", key: key });
    },
    openRunConfirm: function () {
      var flow = selectedFlow();
      api.send({ type: "run.openConfirm", key: flow ? flow.key : undefined });
    },
    selectAndAcceptConfirmation: function (action) {
      if (action === "cancel") {
        api.send({ type: "confirm.cancel" });
        return;
      }
      api.send({ type: "confirm.accept", action: action });
    },
    submitForm: function () {
      api.send({ type: "form.submit", values: collectFormValues() });
    },
    cancelForm: function () {
      api.send({ type: "form.cancel" });
    },
    openInterruptConfirm: function () {
      api.send({ type: "interrupt.openConfirm" });
    },
    interruptFlow: function () {
      api.send({ type: "flow.interrupt" });
    },
    clearLog: function () {
      api.send({ type: "log.clear" });
    },
    openArtifactExplorer: function () {
      api.send({ type: "artifactExplorer.open" });
    },
    closeArtifactExplorer: function () {
      api.send({ type: "artifactExplorer.close" });
    },
    toggleHelp: function () {
      api.send({ type: "help.toggle", visible: !(state.viewModel && state.viewModel.helpVisible) });
    },
    showHelp: function (visible) {
      api.send({ type: "help.toggle", visible: visible });
    },
    scrollPane: function (pane, offset) {
      api.send({ type: "scroll", pane: pane, offset: offset });
    },
    refreshGit: function () {
      api.send({ type: "git.refresh" });
    },
    createGitBranch: function () {
      api.send({ type: "git.createBranch", branchName: elements.gitBranchInput.value });
    },
    checkoutGitBranch: function () {
      api.send({ type: "git.checkout", branchName: elements.gitCheckoutSelect.value });
    },
    fetchGit: function () {
      api.send({ type: "git.fetch" });
    },
    pullGit: function () {
      api.send({ type: "git.pullFfOnly" });
    },
    stageGit: function () {
      api.send({ type: "git.stage", paths: selectedGitPaths() });
    },
    unstageGit: function () {
      api.send({ type: "git.unstage", paths: selectedGitPaths() });
    },
    commitGit: function () {
      api.send({ type: "git.commit", paths: selectedGitPaths(), message: elements.gitCommitMessage.value });
    },
    pushGit: function () {
      api.send({ type: "git.push" });
    },
    updateGitCommitMessage: function () {
      api.send({ type: "git.updateCommitMessage", message: elements.gitCommitMessage.value });
    },
    updateSettings: function (settings) {
      api.send({ type: "settings.update", settings: settings });
    },
    selectAutoFlowPreset: function (preset) {
      api.send({ type: "autoFlow.selectPreset", preset: preset });
    },
    saveAutoFlow: function () {
      api.send({ type: "autoFlow.save" });
    },
    saveAutoFlowAs: function (name) {
      api.send({ type: "autoFlow.save", name: name });
    },
    resetAutoFlow: function () {
      api.send({ type: "autoFlow.reset" });
    },
    toggleAutoFlowBlock: function (slotId, blockId, enabled) {
      api.send({ type: "autoFlow.toggleBlock", slotId: slotId, blockId: blockId, enabled: enabled });
    },
    updateAutoFlowParam: function (slotId, blockId, paramName, value) {
      api.send({ type: "autoFlow.updateParam", slotId: slotId, blockId: blockId, paramName: paramName, value: value });
    },
    insertAutoFlowBlock: function (slotId, blockId) {
      api.send({ type: "autoFlow.insertBlock", slotId: slotId, blockId: blockId });
    },
    removeAutoFlowBlock: function (slotId, blockId) {
      api.send({ type: "autoFlow.removeBlock", slotId: slotId, blockId: blockId });
    },
  };

  function setConnection(nextState) {
    state.connectionState = nextState;
    elements.connection.textContent = nextState.charAt(0).toUpperCase() + nextState.slice(1);
    elements.connection.className = "connection connection-" + nextState;
  }

  function handleServerEvent(raw) {
    var message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      appendLog("[web] Invalid server message: " + error.message);
      return;
    }

    if (message.type === "snapshot") {
      applyWebUiSettings(message.settings);
      var uiState = captureUiState();
      state.viewModel = message.viewModel || {};
      var nextFormId = state.viewModel.form ? state.viewModel.form.formId : null;
      if (nextFormId !== state.formId) {
        state.formValues = state.viewModel.form ? Object.assign({}, state.viewModel.form.values || {}) : {};
        state.formId = nextFormId;
      }
      syncGitSelectionFromSnapshot(state.viewModel.gitWorkspace);
      state.scrollSync.suppress = true;
      render();
      restoreUiState(uiState);
      rememberCurrentScrollOffsets();
      releaseScrollSuppressionSoon();
      return;
    }
    if (message.type === "log.append") {
      appendLog((message.appendedLines || []).join("\n"));
      return;
    }
    if (message.type === "error") {
      appendLog("[web] " + text(message.message, "Unknown protocol error."));
      return;
    }
    if (message.type === "closed") {
      setConnection("closed");
      appendLog("[closed] " + text(message.reason, "Session closed."));
    }
  }

  function syncGitSelectionFromSnapshot(gitWorkspace) {
    if (!gitWorkspace || !Array.isArray(gitWorkspace.changedFiles)) {
      state.gitSelectedPaths = [];
      state.gitChangedFilesSignature = null;
      return;
    }
    var validPaths = gitWorkspace.changedFiles.map(gitFilePath).filter(Boolean);
    var validSet = new Set(validPaths);
    var changedFilesSignature = stableJson(validPaths);
    var serverSelected = Array.isArray(gitWorkspace.selectedPaths)
      ? gitWorkspace.selectedPaths.filter(function (filePath) {
        return validSet.has(filePath);
      })
      : [];
    if (state.gitChangedFilesSignature !== changedFilesSignature) {
      state.gitSelectedPaths = uniqueStrings(serverSelected);
      state.gitChangedFilesSignature = changedFilesSignature;
      return;
    }
    state.gitSelectedPaths = uniqueStrings(state.gitSelectedPaths.filter(function (filePath) {
      return validSet.has(filePath);
    }).concat(serverSelected));
  }

  function uniqueStrings(values) {
    return values.filter(function (value, index, allValues) {
      return typeof value === "string" && value.length > 0 && allValues.indexOf(value) === index;
    });
  }

  function appendLog(lines) {
    if (!lines) return;
    var wasPinned = elements.log.scrollTop + elements.log.clientHeight >= elements.log.scrollHeight - 8;
    elements.log.textContent += (elements.log.textContent ? "\n" : "") + lines;
    if (state.logAutoscroll || wasPinned) {
      scrollLogToBottom();
    }
  }

  function render() {
    var vm = state.viewModel || {};
    elements.title.textContent = text(vm.title, "AgentWeaver");
    elements.header.textContent = text(vm.header, "Local operator console");
    elements.status.textContent = text(vm.statusText, "Idle");
    elements.flowsTitle.textContent = text(vm.flowListTitle, "Flows");
    renderAutoFlowEditorIfChanged(vm);
    elements.progressTitle.textContent = text(vm.progressTitle, "Progress");
    renderProgressIfChanged(vm);
    elements.logTitle.textContent = text(vm.logTitle, "Activity");
    setTextPreservingScroll(elements.log, text(vm.logText, ""), state.logAutoscroll);
    renderHelpIfChanged(vm);
    elements.helpPanel.hidden = !vm.helpVisible;
    elements.help.setAttribute("aria-pressed", vm.helpVisible ? "true" : "false");

    renderFlowsIfChanged(vm);
    renderGitWorkspaceIfChanged(vm);
    renderGitDiffDrawer(vm);
    renderModal(vm);
    renderArtifactExplorerIfChanged(vm);
  }

  function renderIfSignatureChanged(name, signature, renderFn) {
    if (state.renderSignatures[name] === signature) {
      return;
    }
    state.renderSignatures[name] = signature;
    renderFn();
  }

  function renderAutoFlowEditorIfChanged(vm) {
    renderIfSignatureChanged("autoFlow", stableJson({
      autoFlow: vm && vm.autoFlow,
      blocked: hasBlockingInput(vm),
      height: state.autoFlowHeight,
    }), function () {
      renderAutoFlowEditor(vm);
    });
  }

  function renderArtifactExplorerIfChanged(vm) {
    renderIfSignatureChanged("artifact", stableJson({
      explorer: artifactState(vm),
      blocked: hasBlockingInput(vm),
    }), function () {
      renderArtifactExplorer(vm);
    });
  }

  function renderFlowsIfChanged(vm) {
    renderIfSignatureChanged("flows", stableJson({
      flowItems: vm && vm.flowItems,
      selectedFlowIndex: vm && vm.selectedFlowIndex,
    }), function () {
      renderFlows(vm);
    });
  }

  function renderGitWorkspaceIfChanged(vm) {
    renderIfSignatureChanged("git", stableJson({
      gitWorkspace: gitWorkspace(vm),
      blocked: hasBlockingInput(vm),
      selectedPaths: state.gitSelectedPaths,
      commitMessage: state.gitCommitMessage,
    }), function () {
      renderGitWorkspace(vm);
    });
  }

  function renderHelpIfChanged(vm) {
    renderIfSignatureChanged("help", stableJson({
      helpText: vm && vm.helpText,
    }), function () {
      elements.helpText.textContent = text(vm.helpText, "No help is available.");
    });
  }

  function renderProgressIfChanged(vm) {
    renderIfSignatureChanged("progress", stableJson({
      progress: vm && vm.progress,
      progressText: vm && vm.progressText,
    }), function () {
      renderProgress(vm);
    });
  }

  function gitWorkspace(vm) {
    var workspace = vm && vm.gitWorkspace;
    if (!workspace || typeof workspace !== "object") {
      return {
        available: false,
        changedFiles: [],
        branches: [],
        remotes: [],
        selectedPaths: [],
        commitMessage: "",
        operation: { status: "idle" },
      };
    }
    return workspace;
  }

  function renderGitWorkspace(vm) {
    var git = gitWorkspace(vm);
    var blocked = hasBlockingInput(vm);
    var changedFiles = Array.isArray(git.changedFiles) ? git.changedFiles : [];
    var branches = Array.isArray(git.branches) ? git.branches : [];
    var operation = git.operation || { status: "idle" };
    var isRunning = operation.status === "running";

    if (typeof git.commitMessage === "string" && document.activeElement !== elements.gitCommitMessage) {
      state.gitCommitMessage = git.commitMessage;
      elements.gitCommitMessage.value = git.commitMessage;
    }

    elements.gitSummary.innerHTML = "";
    var summary = document.createElement("span");
    if (!git.available) {
      summary.textContent = git.error || "Git workspace is unavailable.";
    } else {
      summary.append(
        document.createTextNode("Branch "),
        strong(git.detachedHead ? "detached HEAD" : (git.branch || "-")),
        document.createTextNode(git.clean ? " | clean" : " | dirty"),
        document.createTextNode(" | upstream " + (git.upstream || "-")),
        document.createTextNode(" | ahead " + (git.ahead || 0) + " behind " + (git.behind || 0)),
      );
      if (git.lastCommit && git.lastCommit.shortHash) {
        summary.append(document.createTextNode(" | last " + git.lastCommit.shortHash + " " + (git.lastCommit.subject || "")));
      }
      if (git.refreshedAt) {
        summary.append(document.createTextNode(" | refreshed " + git.refreshedAt));
      }
    }
    elements.gitSummary.append(summary);

    renderGitBranches(branches, git.branch);
    renderGitFiles(changedFiles);

    elements.gitCreateBranch.disabled = blocked || isRunning || !git.available;
    elements.gitCheckout.disabled = blocked || isRunning || !git.available || !elements.gitCheckoutSelect.value;
    elements.gitFetch.disabled = blocked || isRunning || !git.available;
    elements.gitPull.disabled = blocked || isRunning || !git.available;
    elements.gitStage.disabled = blocked || isRunning || !git.available || selectedStageableGitPaths(git).length === 0;
    elements.gitUnstage.disabled = blocked || isRunning || !git.available || selectedUnstageableGitPaths(git).length === 0;
    elements.gitCommit.disabled = blocked || isRunning || !git.available || elements.gitCommitMessage.value.trim().length === 0;
    elements.gitPush.disabled = blocked || isRunning || !git.available || !git.canPush;
    elements.gitPush.title = git.canPush ? "Push current branch" : (git.pushDisabledReason || "Push is not available.");

    elements.gitFeedback.className = "git-feedback";
    if (operation.status === "error") {
      elements.gitFeedback.classList.add("error");
    } else if (operation.status === "success") {
      elements.gitFeedback.classList.add("success");
    }
    var feedback = operation.message || git.pushDisabledReason || "";
    var warnings = Array.isArray(git.warnings) && git.warnings.length > 0 ? " " + git.warnings.join(" ") : "";
    elements.gitFeedback.textContent = feedback + warnings;
  }

  function strong(value) {
    var element = document.createElement("strong");
    element.textContent = value;
    return element;
  }

  function renderAutoFlowEditor(vm) {
    var model = vm && vm.autoFlow;
    if (!elements.autoFlowEditor) return;
    elements.autoFlowEditor.innerHTML = "";
    if (!model || !Array.isArray(model.slots)) {
      elements.autoFlowEditor.hidden = true;
      if (elements.autoFlowResizer) {
        elements.autoFlowResizer.hidden = true;
      }
      return;
    }
    elements.autoFlowEditor.hidden = false;
    if (elements.autoFlowResizer) {
      elements.autoFlowResizer.hidden = false;
    }
    applyAutoFlowHeight(state.autoFlowHeight);
    var blocked = hasBlockingInput(vm);

    var toolbar = document.createElement("div");
    toolbar.className = "auto-flow-toolbar";
    var simple = document.createElement("button");
    simple.type = "button";
    simple.textContent = "Simple";
    simple.disabled = blocked;
    simple.className = model.basePreset === "simple" ? "primary" : "";
    simple.addEventListener("click", function () {
      api.selectAutoFlowPreset("simple");
    });
    var standard = document.createElement("button");
    standard.type = "button";
    standard.textContent = "Standard";
    standard.disabled = blocked;
    standard.className = model.basePreset === "standard" ? "primary" : "";
    standard.addEventListener("click", function () {
      api.selectAutoFlowPreset("standard");
    });
    var save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.disabled = blocked || !model.status || !model.status.canSave;
    save.addEventListener("click", api.saveAutoFlow);
    var saveAs = document.createElement("button");
    saveAs.type = "button";
    saveAs.textContent = "Save as flow";
    saveAs.disabled = blocked || !model.status || !model.status.canSave;
    saveAs.addEventListener("click", function () {
      var defaultName = model.configName && model.configName.indexOf("preset-") !== 0
        ? model.configName
        : "";
      var name = window.prompt("Flow config name", defaultName);
      var normalizedName = name ? name.trim() : "";
      if (!normalizedName) {
        return;
      }
      api.saveAutoFlowAs(normalizedName);
    });
    var reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset";
    reset.disabled = blocked || !model.status || !model.status.canReset;
    reset.title = "Discard unsaved auto-flow edits";
    reset.addEventListener("click", api.resetAutoFlow);
    var status = document.createElement("span");
    status.className = "auto-flow-status " + (model.status && model.status.valid ? "valid" : "invalid");
    status.textContent = (model.status && model.status.valid ? "valid" : "invalid") + " | " + text(model.status && model.status.sourceLabel, model.configName || "auto-flow");
    toolbar.append(simple, standard, save, saveAs, reset, status);
    elements.autoFlowEditor.append(toolbar);

    if (model.status && model.status.lastMessage) {
      var message = document.createElement("div");
      message.className = "auto-flow-message";
      message.textContent = model.status.lastMessage;
      elements.autoFlowEditor.append(message);
    }

    if (Array.isArray(model.diagnostics) && model.diagnostics.length > 0) {
      var diagnostics = document.createElement("div");
      diagnostics.className = "auto-flow-diagnostics";
      model.diagnostics.forEach(function (diagnostic) {
        var item = document.createElement("div");
        item.textContent = diagnostic.message || "Invalid auto-flow configuration.";
        diagnostics.append(item);
      });
      elements.autoFlowEditor.append(diagnostics);
    }

    var slots = document.createElement("div");
    slots.className = "auto-flow-slots";
    model.slots.forEach(function (slot) {
      var slotRow = document.createElement("section");
      slotRow.className = "auto-flow-slot status-" + slot.status;
      slotRow.dataset.slotId = slot.slotId;
      var title = document.createElement("div");
      title.className = "auto-flow-slot-title";
      title.append(strong(text(slot.title, slot.slotId)), document.createTextNode(" "), statusPill(slot.status));
      var reason = document.createElement("div");
      reason.className = "auto-flow-reason";
      reason.textContent = text(slot.reason, "");
      slotRow.append(title, reason);

      var blockList = document.createElement("div");
      blockList.className = "auto-flow-blocks";
      if (!Array.isArray(slot.blocks) || slot.blocks.length === 0) {
        var empty = document.createElement("div");
        empty.className = "auto-flow-empty";
        empty.textContent = "Empty slot.";
        blockList.append(empty);
      } else {
        slot.blocks.forEach(function (block) {
          blockList.append(renderAutoFlowBlock(block, blocked));
        });
      }
      slotRow.append(blockList);
      var insert = renderAutoFlowInsert(slot, model.availableBlocks || [], blocked);
      if (insert) {
        slotRow.append(insert);
      }
      slots.append(slotRow);
    });
    elements.autoFlowEditor.append(slots);
    updateAutoFlowResizerState(state.autoFlowHeight);
  }

  function statusPill(status) {
    var pill = document.createElement("span");
    pill.className = "auto-flow-pill status-" + status;
    pill.textContent = status || "pending";
    return pill;
  }

  function renderAutoFlowBlock(block, blocked) {
    var row = document.createElement("div");
    row.className = "auto-flow-block status-" + block.status;
    row.dataset.blockId = block.blockId;
    row.dataset.slotId = block.slotId;
    var enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.id = controlId("auto-flow-enabled", block.slotId, block.blockId);
    enabled.name = enabled.id;
    enabled.checked = block.enabled !== false;
    enabled.disabled = blocked || block.locked || !(block.actions && (block.actions.canEnable || block.actions.canDisable));
    enabled.title = block.locked ? "Locked core block" : "Enable or disable block";
    enabled.addEventListener("change", function () {
      api.toggleAutoFlowBlock(block.slotId, block.blockId, enabled.checked);
    });
    var main = document.createElement("div");
    main.className = "auto-flow-block-main";
    var label = document.createElement("div");
    label.className = "auto-flow-block-label";
    label.append(strong(text(block.title, block.blockId)), document.createTextNode(" "), statusPill(block.status));
    if (block.locked) {
      var locked = document.createElement("span");
      locked.className = "auto-flow-locked";
      locked.textContent = "locked";
      label.append(document.createTextNode(" "), locked);
    }
    var reason = document.createElement("div");
    reason.className = "auto-flow-reason";
    reason.textContent = text(block.reason, "");
    main.append(label, reason);
    if (Array.isArray(block.params) && block.params.length > 0) {
      var params = document.createElement("div");
      params.className = "auto-flow-params";
      block.params.forEach(function (param) {
        var field = document.createElement("label");
        field.textContent = param.label + " ";
        var input = document.createElement("input");
        input.type = "number";
        input.id = controlId("auto-flow-param", block.slotId, block.blockId, param.name);
        input.name = input.id;
        input.min = String(param.min);
        input.max = String(param.max);
        input.step = "1";
        input.value = param.value === null || param.value === undefined ? "" : String(param.value);
        input.disabled = blocked || !(block.actions && block.actions.canEditParams);
        input.addEventListener("change", function () {
          var next = Number(input.value);
          if (Number.isInteger(next)) {
            api.updateAutoFlowParam(block.slotId, block.blockId, param.name, next);
          }
        });
        field.append(input);
        params.append(field);
      });
      main.append(params);
    }
    row.append(enabled, main);
    if (block.actions && block.actions.canRemove) {
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Delete";
      remove.disabled = blocked;
      remove.title = "Remove block from this slot";
      remove.addEventListener("click", function (event) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        api.removeAutoFlowBlock(block.slotId, block.blockId);
      });
      row.append(remove);
    }
    return row;
  }

  function renderAutoFlowInsert(slot, availableBlocks, blocked) {
    var configured = new Set((Array.isArray(slot.blocks) ? slot.blocks : []).map(function (block) {
      return block.blockId;
    }));
    var candidates = availableBlocks.filter(function (block) {
      return Array.isArray(block.allowedSlots)
        && block.allowedSlots.indexOf(slot.slotId) !== -1
        && !configured.has(block.blockId);
    });
    if (candidates.length === 0) {
      return null;
    }
    var container = document.createElement("div");
    container.className = "auto-flow-insert";
    var select = document.createElement("select");
    select.id = controlId("auto-flow-insert", slot.slotId);
    select.name = select.id;
    select.value = "";
    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Add block...";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    candidates.forEach(function (block) {
      var option = document.createElement("option");
      option.value = block.blockId;
      option.textContent = block.title || block.blockId;
      select.append(option);
    });
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Insert";
    button.disabled = blocked || !select.value;
    select.addEventListener("change", function () {
      button.disabled = blocked || !select.value;
    });
    button.addEventListener("click", function (event) {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (!select.value) {
        return;
      }
      api.insertAutoFlowBlock(slot.slotId, select.value);
    });
    container.append(select, button);
    return container;
  }

  function renderGitBranches(branches, currentBranch) {
    elements.gitCheckoutSelect.innerHTML = "";
    branches.forEach(function (branch) {
      var option = document.createElement("option");
      option.value = branch.name;
      option.textContent = branch.current ? branch.name + " (current)" : branch.name;
      option.selected = branch.name === currentBranch;
      elements.gitCheckoutSelect.append(option);
    });
  }

  function renderGitFiles(files) {
    elements.gitFiles.innerHTML = "";
    if (!Array.isArray(files) || files.length === 0) {
      var empty = document.createElement("div");
      empty.className = "git-empty";
      empty.textContent = "No changed files.";
      elements.gitFiles.append(empty);
      return;
    }

    var tree = buildGitFileTree(files);
    elements.gitFiles.setAttribute("role", "tree");
    tree.forEach(function (root) {
      elements.gitFiles.append(renderGitTreeNode(root, 0));
    });
  }

  function buildGitFileTree(files) {
    var roots = [
      createGitTreeNode("group", "modified", "modified", "modified"),
      createGitTreeNode("group", "untracked", "untracked", "untracked"),
    ];
    var rootByKey = { modified: roots[0], untracked: roots[1] };
    files.forEach(function (file) {
      var filePath = file.path || file.file || "";
      if (!filePath) return;
      var rootKey = gitRootKey(file);
      var parent = rootByKey[rootKey] || rootByKey.modified;
      var parts = filePath.split("/").filter(Boolean);
      var leafName = parts.pop() || filePath;
      parts.forEach(function (part) {
        parent = findOrCreateGitDirectory(parent, part);
      });
      var leaf = createGitTreeNode("file", leafName, filePath, rootKey);
      leaf.file = file;
      leaf.path = filePath;
      parent.children.push(leaf);
    });
    roots.forEach(sortGitTreeNode);
    return roots;
  }

  function gitRootKey(file) {
    return file && (file.type === "untracked" || file.xy === "??") ? "untracked" : "modified";
  }

  function createGitTreeNode(kind, name, label, rootKey) {
    return {
      kind: kind,
      name: name,
      label: label,
      rootKey: rootKey,
      children: [],
      file: null,
      path: null,
    };
  }

  function findOrCreateGitDirectory(parent, name) {
    var existing = parent.children.find(function (child) {
      return child.kind === "dir" && child.name === name;
    });
    if (existing) return existing;
    var directory = createGitTreeNode("dir", name, name, parent.rootKey);
    parent.children.push(directory);
    return directory;
  }

  function sortGitTreeNode(node) {
    node.children.sort(function (left, right) {
      if (left.kind === "dir" && right.kind !== "dir") return -1;
      if (left.kind !== "dir" && right.kind === "dir") return 1;
      return left.name.localeCompare(right.name);
    });
    node.children.forEach(sortGitTreeNode);
  }

  function renderGitTreeNode(node, depth) {
    var paths = gitTreePaths(node);
    var selectedCount = paths.filter(function (filePath) {
      return state.gitSelectedPaths.indexOf(filePath) !== -1;
    }).length;
    var checked = paths.length > 0 && selectedCount === paths.length;
    var indeterminate = selectedCount > 0 && selectedCount < paths.length;
    var row = document.createElement("label");
    row.className = node.kind === "file" ? "git-file-row git-tree-row" : "git-tree-row git-tree-" + node.kind;
    row.style.paddingLeft = String(8 + depth * 18) + "px";
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-checked", indeterminate ? "mixed" : String(checked));
    if (node.kind === "file" && node.path) {
      row.dataset.path = node.path;
    } else if (node.kind === "group") {
      row.dataset.gitRoot = node.rootKey;
    }

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = controlId("git-select", node.kind, node.rootKey, node.path || node.label || node.name);
    checkbox.name = checkbox.id;
    checkbox.checked = checked;
    checkbox.indeterminate = indeterminate;
    checkbox.disabled = paths.length === 0;
    checkbox.addEventListener("change", function () {
      setGitSelection(paths, checkbox.checked);
      renderGitWorkspace(state.viewModel || {});
    });

    var typeLabel = gitTreeTypeLabel(node);
    var type = null;
    if (typeLabel) {
      type = document.createElement("span");
      type.className = "git-file-type" + (typeLabel === "staged" ? " staged" : "");
      type.textContent = typeLabel;
    } else {
      row.classList.add("without-type");
    }

    var pathText = document.createElement("span");
    pathText.className = "git-file-path";
    pathText.textContent = gitTreeDisplayLabel(node);

    var meta = document.createElement("span");
    meta.className = "git-file-meta";
    meta.textContent = node.kind === "file" ? gitFileMeta(node.file) : paths.length + " file" + (paths.length === 1 ? "" : "s");

    row.append(checkbox);
    if (type) row.append(type);
    row.append(pathText, meta);
    if (node.kind === "file" && node.path) {
      var diffButton = document.createElement("button");
      diffButton.type = "button";
      diffButton.className = "git-diff-open";
      diffButton.textContent = "Diff";
      diffButton.setAttribute("aria-label", "Open diff for " + node.path);
      diffButton.addEventListener("click", function (event) {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
        openGitDiff(node.path);
      });
      row.append(diffButton);
    }
    if (node.kind === "file") {
      return row;
    }

    var container = document.createElement("div");
    container.className = "git-tree-node";
    container.append(row);
    node.children.forEach(function (child) {
      container.append(renderGitTreeNode(child, depth + 1));
    });
    return container;
  }

  function gitTreeTypeLabel(node) {
    if (node.kind === "group") return node.rootKey;
    if (node.kind === "dir") return "";
    if (node.file && isGitFileStaged(node.file) && !needsGitFileStage(node.file)) return "staged";
    return (node.file && (node.file.type || node.file.xy)) || "changed";
  }

  function gitTreeDisplayLabel(node) {
    if (node.kind !== "file") return node.label;
    var file = node.file || {};
    return file.originalPath || file.originalFile
      ? (file.originalPath || file.originalFile) + " -> " + (node.path || "")
      : (node.path || node.label);
  }

  function gitFileMeta(file) {
    file = file || {};
    if (file.type === "untracked" || file.xy === "??") return "untracked";
    if (isGitFileStaged(file) && needsGitFileStage(file)) return "staged+unstaged";
    if (isGitFileStaged(file)) return "staged";
    if (needsGitFileStage(file)) return "unstaged";
    return (file.xy || "").trim() || "changed";
  }

  function gitTreePaths(node) {
    if (node.kind === "file") return node.path ? [node.path] : [];
    return node.children.reduce(function (paths, child) {
      return paths.concat(gitTreePaths(child));
    }, []);
  }

  function setGitSelection(paths, selected) {
    if (selected) {
      paths.forEach(function (filePath) {
        if (state.gitSelectedPaths.indexOf(filePath) === -1) {
          state.gitSelectedPaths.push(filePath);
        }
      });
      return;
    }
    state.gitSelectedPaths = state.gitSelectedPaths.filter(function (filePath) {
      return paths.indexOf(filePath) === -1;
    });
  }

  function selectedGitPaths() {
    return state.gitSelectedPaths.slice();
  }

  function gitChangedFiles() {
    var git = gitWorkspace(state.viewModel || {});
    return Array.isArray(git.changedFiles) ? git.changedFiles : [];
  }

  function gitFilePath(file) {
    return file && (file.path || file.file) || "";
  }

  function findGitChangedFile(filePath) {
    return gitChangedFiles().find(function (file) {
      return gitFilePath(file) === filePath || file.file === filePath;
    }) || null;
  }

  function openGitDiff(filePath) {
    state.gitDiff.open = true;
    state.gitDiff.selectedPath = filePath;
    state.gitDiff.error = null;
    state.gitDiff.diff = null;
    fetchGitDiff();
    renderGitDiffDrawer(state.viewModel || {});
  }

  function closeGitDiff() {
    state.gitDiff.open = false;
    state.gitDiff.requestId += 1;
    state.gitDiff.loading = false;
    renderGitDiffDrawer(state.viewModel || {});
  }

  function setGitDiffMode(mode) {
    if (state.gitDiff.mode === mode) {
      return;
    }
    state.gitDiff.mode = mode;
    state.gitDiff.error = null;
    state.gitDiff.diff = null;
    if (state.gitDiff.open && state.gitDiff.selectedPath) {
      fetchGitDiff();
    }
    renderGitDiffDrawer(state.viewModel || {});
  }

  function gitDiffApiUrl(filePath, mode) {
    var params = new URLSearchParams();
    params.set("path", filePath);
    params.set("mode", mode);
    return "/__agentweaver/api/git/diff?" + params.toString();
  }

  function fetchGitDiff() {
    var filePath = state.gitDiff.selectedPath;
    if (!filePath) {
      return;
    }
    var requestId = state.gitDiff.requestId + 1;
    state.gitDiff.requestId = requestId;
    state.gitDiff.loading = true;
    state.gitDiff.error = null;
    state.gitDiff.diff = null;
    fetch(gitDiffApiUrl(filePath, state.gitDiff.mode))
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.message ? body.message : "Git diff request failed.");
          }
          return body;
        });
      })
      .then(function (diff) {
        if (requestId !== state.gitDiff.requestId) {
          return;
        }
        state.gitDiff.loading = false;
        state.gitDiff.diff = diff;
        state.gitDiff.error = null;
        renderGitDiffDrawer(state.viewModel || {});
      })
      .catch(function (error) {
        if (requestId !== state.gitDiff.requestId) {
          return;
        }
        state.gitDiff.loading = false;
        state.gitDiff.diff = null;
        state.gitDiff.error = error.message || "Git diff request failed.";
        renderGitDiffDrawer(state.viewModel || {});
      });
  }

  function renderGitDiffDrawer(vm) {
    var files = gitChangedFiles();
    var selectedPath = state.gitDiff.selectedPath;
    var selectedPathChanged = false;
    if (selectedPath && !findGitChangedFile(selectedPath)) {
      selectedPath = files[0] ? gitFilePath(files[0]) : null;
      state.gitDiff.selectedPath = selectedPath;
      state.gitDiff.diff = null;
      state.gitDiff.error = null;
      state.gitDiff.loading = false;
      selectedPathChanged = Boolean(selectedPath);
    }
    elements.gitDiffDrawer.hidden = !state.gitDiff.open;
    elements.gitDiffTitle.textContent = "Git Diff Viewer";
    elements.gitDiffMeta.textContent = files.length === 0
      ? "No changed files are available."
      : String(files.length) + " changed file" + (files.length === 1 ? "" : "s") + ".";
    if (!state.gitDiff.open) {
      return;
    }
    if (selectedPathChanged) {
      fetchGitDiff();
    }
    renderGitDiffFileList(files);
    renderGitDiffModeControls();
    renderGitDiffPreview(vm);
  }

  function renderGitDiffFileList(files) {
    elements.gitDiffFileList.innerHTML = "";
    if (!Array.isArray(files) || files.length === 0) {
      var empty = document.createElement("div");
      empty.className = "git-diff-empty";
      empty.textContent = "No changed files.";
      elements.gitDiffFileList.append(empty);
      return;
    }
    files.forEach(function (file) {
      var filePath = gitFilePath(file);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "git-diff-file" + (filePath === state.gitDiff.selectedPath ? " selected" : "");
      button.dataset.path = filePath;
      button.setAttribute("aria-pressed", filePath === state.gitDiff.selectedPath ? "true" : "false");
      button.addEventListener("click", function () {
        if (state.gitDiff.selectedPath !== filePath) {
          openGitDiff(filePath);
        }
      });
      var title = document.createElement("strong");
      title.textContent = file.originalPath || file.originalFile
        ? (file.originalPath || file.originalFile) + " -> " + filePath
        : filePath;
      var meta = document.createElement("span");
      meta.textContent = gitFileMeta(file);
      button.append(title, meta);
      elements.gitDiffFileList.append(button);
    });
  }

  function renderGitDiffModeControls() {
    ensureGitDiffModeButtons();
    Array.prototype.slice.call(elements.gitDiffModeControls.querySelectorAll("button")).forEach(function (button) {
      var mode = button.dataset.gitDiffMode || "head";
      var active = state.gitDiff.mode === mode;
      button.className = active ? "primary" : "";
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function ensureGitDiffModeButtons() {
    if (elements.gitDiffModeControls.querySelectorAll("button").length > 0) {
      return;
    }
    [
      ["head", "All"],
      ["staged", "Staged"],
      ["worktree", "Unstaged"],
    ].forEach(function (entry) {
      var button = document.createElement("button");
      button.type = "button";
      button.dataset.gitDiffMode = entry[0];
      button.textContent = entry[1];
      elements.gitDiffModeControls.append(button);
    });
  }

  function renderGitDiffPreview(vm) {
    var selected = state.gitDiff.selectedPath ? findGitChangedFile(state.gitDiff.selectedPath) : null;
    if (!selected) {
      elements.gitDiffSelectedTitle.textContent = "Diff";
      elements.gitDiffSelectedMeta.textContent = "No file selected.";
      elements.gitDiffStatus.textContent = "";
      renderGitDiffMessage("Select a changed file to inspect its diff.", false);
      return;
    }
    var displayPath = selected.originalPath || selected.originalFile
      ? (selected.originalPath || selected.originalFile) + " -> " + gitFilePath(selected)
      : gitFilePath(selected);
    elements.gitDiffSelectedTitle.textContent = displayPath;
    elements.gitDiffSelectedMeta.textContent = [gitFileMeta(selected), gitModeLabel(state.gitDiff.mode)].join(" | ");
    if (state.gitDiff.loading) {
      elements.gitDiffStatus.textContent = "Loading diff...";
      renderGitDiffMessage("Loading diff...", false);
      return;
    }
    if (state.gitDiff.error) {
      elements.gitDiffStatus.textContent = state.gitDiff.error;
      renderGitDiffMessage(state.gitDiff.error, true);
      return;
    }
    var diff = state.gitDiff.diff;
    if (!diff) {
      elements.gitDiffStatus.textContent = "Diff has not been loaded yet.";
      renderGitDiffMessage("Diff has not been loaded yet.", false);
      return;
    }
    elements.gitDiffStatus.textContent = diff.message || "";
    renderGitDiffContent(diff);
  }

  function gitModeLabel(mode) {
    if (mode === "staged") return "Staged";
    if (mode === "worktree") return "Unstaged";
    return "All";
  }

  function renderGitDiffMessage(message, failed) {
    elements.gitDiffBody.textContent = "";
    elements.gitDiffBody.className = "git-diff-body" + (failed ? " error-text" : "");
    elements.gitDiffBody.textContent = message;
  }

  function renderGitDiffContent(diff) {
    elements.gitDiffBody.textContent = "";
    elements.gitDiffBody.className = "git-diff-body";
    if (diff.binary) {
      renderGitDiffMessage(diff.message || "Binary file diff is not displayed.", false);
      return;
    }
    if (diff.tooLarge) {
      renderGitDiffMessage(diff.message || "Diff is too large to display.", false);
      return;
    }
    if (diff.empty || !Array.isArray(diff.hunks) || diff.hunks.length === 0) {
      renderGitDiffMessage(diff.message || "No diff is available for this mode.", false);
      return;
    }
    var table = document.createElement("div");
    table.className = "git-diff-table";
    diff.hunks.forEach(function (hunk) {
      var hunkRow = document.createElement("div");
      hunkRow.className = "git-diff-hunk";
      hunkRow.textContent = hunk.header || "@@";
      table.append(hunkRow);
      (Array.isArray(hunk.rows) ? hunk.rows : []).forEach(function (row) {
        table.append(renderGitDiffRow(row));
      });
    });
    elements.gitDiffBody.append(table);
  }

  function renderGitDiffRow(row) {
    var element = document.createElement("div");
    var kind = row && row.kind ? row.kind : "context";
    element.className = "git-diff-row row-" + kind;
    var leftNumber = document.createElement("span");
    leftNumber.className = "git-diff-line-number";
    leftNumber.textContent = row.leftLineNumber === null || row.leftLineNumber === undefined ? "" : String(row.leftLineNumber);
    var leftText = document.createElement("code");
    leftText.className = "git-diff-code left";
    leftText.textContent = row.leftText || "";
    var rightNumber = document.createElement("span");
    rightNumber.className = "git-diff-line-number";
    rightNumber.textContent = row.rightLineNumber === null || row.rightLineNumber === undefined ? "" : String(row.rightLineNumber);
    var rightText = document.createElement("code");
    rightText.className = "git-diff-code right";
    rightText.textContent = row.rightText || "";
    element.append(leftNumber, leftText, rightNumber, rightText);
    return element;
  }

  function selectedStageableGitPaths(git) {
    return selectedGitPathsFor(git, needsGitFileStage);
  }

  function selectedUnstageableGitPaths(git) {
    return selectedGitPathsFor(git, isGitFileStaged);
  }

  function selectedGitPathsFor(git, predicate) {
    git = git || gitWorkspace(state.viewModel || {});
    var selected = selectedGitPaths();
    var selectedSet = new Set(selected);
    var files = Array.isArray(git.changedFiles) ? git.changedFiles : [];
    return files.filter(function (file) {
      var filePath = file.path || file.file || "";
      return selectedSet.has(filePath) && predicate(file);
    }).map(function (file) {
      return file.path || file.file || "";
    });
  }

  function needsGitFileStage(file) {
    if (!file) return false;
    if (file.type === "untracked" || file.xy === "??") return true;
    var workTreeStatus = typeof file.workTreeStatus === "string" ? file.workTreeStatus : (file.xy || "  ")[1];
    return workTreeStatus !== " " && workTreeStatus !== undefined;
  }

  function isGitFileStaged(file) {
    if (!file) return false;
    var indexStatus = typeof file.indexStatus === "string" ? file.indexStatus : (file.xy || "  ")[0];
    return indexStatus !== " " && indexStatus !== "?";
  }

  function renderProgress(vm) {
    var progress = vm && vm.progress;
    var items = progress && Array.isArray(progress.items) ? progress.items.filter(isProgressItem) : [];
    renderProgressFlowLabel(progress && progress.flow ? text(progress.flow.label, progress.flow.id || "") : "");
    if (!progress || !progress.flow || items.length === 0) {
      var fallbackText = text(vm && vm.progressText, "No progress yet.");
      elements.progress.className = "progress-tree fallback";
      if (elements.progress.children.length > 0) {
        var previousFallbackScrollTop = elements.progress.scrollTop;
        var fallbackWasPinned = previousFallbackScrollTop + elements.progress.clientHeight >= elements.progress.scrollHeight - 8;
        elements.progress.textContent = fallbackText;
        elements.progress.scrollTop = fallbackWasPinned ? elements.progress.scrollHeight : previousFallbackScrollTop;
      } else {
        setTextPreservingScroll(elements.progress, fallbackText);
      }
      return;
    }

    var previousScrollTop = elements.progress.scrollTop;
    var wasPinned = previousScrollTop + elements.progress.clientHeight >= elements.progress.scrollHeight - 8;
    elements.progress.className = "progress-tree";
    elements.progress.innerHTML = "";

    items.forEach(function (item, index) {
      elements.progress.append(renderProgressRow(item, index));
    });
    elements.progress.scrollTop = wasPinned ? elements.progress.scrollHeight : previousScrollTop;
  }

  function renderProgressFlowLabel(label) {
    if (!elements.progressFlowLabel) {
      return;
    }
    var value = text(label, "");
    elements.progressFlowLabel.textContent = value;
    elements.progressFlowLabel.hidden = value.length === 0;
  }

  function isProgressItem(item) {
    if (!item || typeof item !== "object") return false;
    if (["group", "phase", "step", "slot", "block", "termination"].indexOf(item.kind) === -1) return false;
    if (["pending", "running", "done", "success", "failed", "stopped", "skipped", "waiting-user", "disabled", "blocked", "invalid", "empty"].indexOf(item.status) === -1) return false;
    return typeof item.label === "string" && Number.isFinite(item.depth);
  }

  function renderProgressRow(item, index) {
    var depth = Math.max(0, Math.min(12, Math.floor(item.depth)));
    var detailText = renderableProgressDetail(item);
    var row = document.createElement("div");
    row.className = "progress-row kind-" + item.kind + " status-" + item.status;
    if (detailText.length > 0) {
      row.className += " has-detail";
    }
    row.dataset.kind = item.kind;
    row.dataset.status = item.status;
    row.dataset.depth = String(depth);
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-current", item.status === "running" ? "step" : "false");
    row.style.paddingLeft = String(8 + depth * 18) + "px";
    row.title = item.kind + ": " + item.status;

    var marker = document.createElement("span");
    marker.className = "progress-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = progressMarker(item.status);

    var body = document.createElement("span");
    body.className = "progress-row-body";

    var label = document.createElement("span");
    label.className = "progress-label";
    label.textContent = text(item.label, "Untitled progress item");
    body.append(label);

    if (detailText.length > 0) {
      var detail = document.createElement("span");
      detail.className = "progress-detail";
      detail.textContent = detailText;
      body.append(detail);
    }

    row.append(marker, body);
    row.dataset.index = String(index);
    return row;
  }

  function renderableProgressDetail(item) {
    if (typeof item.detail !== "string") {
      return "";
    }
    var detail = item.detail.trim();
    if (detail.length === 0) {
      return "";
    }
    if (item.kind === "termination") {
      return detail;
    }
    if ([
      "Slot is configured.",
      "Locked core block.",
      "Included by preset default.",
      "Configured in saved auto-flow config.",
      "Optional block is disabled.",
      "No blocks are configured for this optional slot.",
      "All optional blocks in this slot are disabled.",
      "Skipped because the slot override omitted this preset default block."
    ].indexOf(detail) !== -1) {
      return "";
    }
    return detail;
  }

  function progressMarker(status) {
    if (status === "done" || status === "success") return "✓";
    if (status === "failed" || status === "invalid") return "×";
    if (status === "stopped" || status === "blocked") return "■";
    if (status === "running" || status === "waiting-user") return "●";
    if (status === "skipped") return "↷";
    if (status === "disabled" || status === "empty") return "·";
    return "○";
  }

  function setTextPreservingScroll(element, value, forceBottom) {
    if (element.textContent === value) {
      if (forceBottom) {
        element.scrollTop = element.scrollHeight;
      }
      return;
    }
    var previousScrollTop = element.scrollTop;
    var wasPinned = previousScrollTop + element.clientHeight >= element.scrollHeight - 8;
    element.textContent = value;
    element.scrollTop = forceBottom || wasPinned ? element.scrollHeight : previousScrollTop;
  }

  function captureUiState() {
    var active = document.activeElement;
    var activeFieldId = active && active.dataset ? active.dataset.fieldId : null;
    var activeFieldValue = active && active.dataset && active.dataset.fieldId && "value" in active ? active.value : null;
    var selectionStart = null;
    var selectionEnd = null;
    var modalBody = currentModalBody();
    if (activeFieldId && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    }
    return {
      progressScrollTop: elements.progress.scrollTop,
      logScrollTop: elements.log.scrollTop,
      helpScrollTop: elements.helpText.scrollTop,
      modalScrollTop: elements.modalRoot.scrollTop,
      modalBodyScrollTop: modalBody ? modalBody.scrollTop : 0,
      activeFieldId: activeFieldId,
      activeFieldValue: activeFieldValue,
      selectionStart: selectionStart,
      selectionEnd: selectionEnd,
      formId: state.viewModel && state.viewModel.form ? state.viewModel.form.formId : null,
    };
  }

  function restoreUiState(uiState) {
    if (!uiState) return;
    elements.progress.scrollTop = uiState.progressScrollTop;
    elements.log.scrollTop = state.logAutoscroll ? elements.log.scrollHeight : uiState.logScrollTop;
    elements.helpText.scrollTop = uiState.helpScrollTop;
    elements.modalRoot.scrollTop = uiState.modalScrollTop;
    var modalBody = currentModalBody();
    if (modalBody) {
      modalBody.scrollTop = uiState.modalBodyScrollTop;
    }

    var currentFormId = state.viewModel && state.viewModel.form ? state.viewModel.form.formId : null;
    if (!uiState.activeFieldId || uiState.formId !== currentFormId) {
      return;
    }
    var selector = '[data-field-id="' + cssEscape(uiState.activeFieldId) + '"]';
    if (uiState.activeFieldValue !== null) {
      selector += '[value="' + cssEscape(uiState.activeFieldValue) + '"]';
    }
    var field = elements.modalRoot.querySelector(selector);
    if (!field) {
      field = elements.modalRoot.querySelector('[data-field-id="' + cssEscape(uiState.activeFieldId) + '"] input, [data-field-id="' + cssEscape(uiState.activeFieldId) + '"] textarea, input[data-field-id="' + cssEscape(uiState.activeFieldId) + '"], textarea[data-field-id="' + cssEscape(uiState.activeFieldId) + '"]');
    }
    if (!field || typeof field.focus !== "function") {
      return;
    }
    field.focus();
    if (typeof field.setSelectionRange === "function" && uiState.selectionStart !== null && uiState.selectionEnd !== null) {
      var valueLength = typeof field.value === "string" ? field.value.length : 0;
      field.setSelectionRange(Math.min(uiState.selectionStart, valueLength), Math.min(uiState.selectionEnd, valueLength));
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function currentModalBody() {
    return elements.modalRoot.querySelector(".modal-body");
  }

  function renderFlows(vm) {
    elements.flows.innerHTML = "";
    var items = Array.isArray(vm.flowItems) ? vm.flowItems : [];
    if (items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "flow-meta";
      empty.textContent = "No flows are available.";
      elements.flows.append(empty);
      return;
    }

    items.forEach(function (item, index) {
      var folder = isFolder(item);
      var depth = Number.isFinite(item.depth) ? Math.max(0, item.depth) : 0;
      var row = document.createElement("button");
      row.type = "button";
      row.className = "flow-row" + (folder ? " folder" : "") + (index === vm.selectedFlowIndex ? " selected" : "");
      row.setAttribute("role", folder ? "treeitem" : "option");
      row.style.paddingLeft = String(6 + depth * 18) + "px";
      row.title = item.key || item.label || "";
      row.addEventListener("click", function () {
        if (folder) {
          api.toggleFolder(item.key);
        } else {
          api.selectFlow(index, item.key);
        }
      });
      row.addEventListener("dblclick", function () {
        if (!folder) {
          api.send({ type: "run.openConfirm", key: item.key });
        }
      });

      var icon = document.createElement("span");
      icon.className = "flow-icon";
      icon.textContent = folder ? (item.expanded ? "▾" : "▸") : "•";
      var label = document.createElement("span");
      label.className = "flow-label";
      label.textContent = text(item.name, item.label || item.key || "Untitled flow").replace(/^[\s▸▾•]+/, "");
      var meta = document.createElement("span");
      meta.className = "flow-meta";
      meta.textContent = flowMeta(item);
      row.append(icon, label, meta);
      elements.flows.append(row);
    });
  }

  function artifactState(vm) {
    var explorer = vm && vm.artifactExplorer;
    if (!explorer || typeof explorer !== "object") {
      return {
        available: false,
        open: false,
        scopeKey: null,
        runId: null,
        status: "unavailable",
        label: "Artifact Explorer",
        message: "",
      };
    }
    return explorer;
  }

  function hasBlockingInput(vm) {
    return Boolean(vm && (vm.confirmation || vm.confirmText || vm.form));
  }

  function artifactSignature(explorer) {
    return [
      explorer.scopeKey || "",
      explorer.runId || "",
      Array.isArray(explorer.runIds) ? explorer.runIds.join(",") : "",
      explorer.status || "",
      typeof explorer.artifactCount === "number" ? String(explorer.artifactCount) : "",
    ].join("|");
  }

  function renderArtifactExplorer(vm) {
    var explorer = artifactState(vm);
    var blocked = hasBlockingInput(vm);
    elements.artifactOpen.hidden = !explorer.available || explorer.open || blocked;
    elements.artifactOpen.textContent = explorer.label || "Artifacts";
    elements.artifactDrawer.hidden = !explorer.open;
    elements.artifactTitle.textContent = explorer.label || "Artifact Explorer";
    elements.artifactMeta.textContent = artifactMetaText(explorer);
    elements.artifactMessage.textContent = explorer.message || "";

    if (!explorer.open) {
      return;
    }

    var signature = artifactSignature(explorer);
    if (signature !== state.artifacts.signature) {
      state.artifacts.signature = signature;
      state.artifacts.loading = false;
      state.artifacts.catalog = null;
      state.artifacts.error = null;
      state.artifacts.preview = null;
      state.artifacts.selectedId = null;
      state.artifacts.actionStatus = null;
      state.artifacts.actionStatusFailed = false;
      state.artifacts.previewRequestId += 1;
      state.artifacts.viewerModes = {};
      fetchArtifacts(explorer);
    }
    renderArtifactList(explorer);
    renderArtifactPreview(explorer);
  }

  function artifactMetaText(explorer) {
    var parts = [];
    var count = typeof explorer.artifactCount === "number" ? explorer.artifactCount : null;
    if (explorer.status === "completed") {
      parts.push("Workflow completed. " + artifactCountText(count));
    } else if (explorer.status === "failed") {
      parts.push("Workflow failed. " + artifactCountText(count));
    } else if (count !== null) {
      parts.push(artifactCountText(count));
    }
    if (explorer.scopeKey) {
      parts.push("Scope " + explorer.scopeKey);
    }
    if (Array.isArray(explorer.runIds) && explorer.runIds.length > 1) {
      parts.push("Current runs " + explorer.runIds.join(", "));
    } else if (explorer.runId) {
      parts.push("Current run " + explorer.runId);
    }
    return parts.join(" | ");
  }

  function artifactCountText(count) {
    if (typeof count !== "number") {
      return "Artifacts are available.";
    }
    return String(count) + " artifact" + (count === 1 ? "" : "s") + " in scope.";
  }

  function artifactApiUrl(explorer, suffix) {
    var base = "/__agentweaver/api/artifacts" + (suffix || "");
    var params = new URLSearchParams();
    if (explorer.scopeKey) {
      params.set("scope", explorer.scopeKey);
    }
    var query = params.toString();
    return query ? base + "?" + query : base;
  }

  function artifactGroups(catalog) {
    if (catalog && Array.isArray(catalog.groups) && catalog.groups.length > 0) {
      return catalog.groups.map(function (group) {
        return {
          title: group.title || group.phaseId || "Artifacts",
          items: Array.isArray(group.items) ? group.items : [],
          groups: Array.isArray(group.groups) ? artifactGroups({ groups: group.groups }) : [],
        };
      });
    }
    return [{
      title: "Artifacts",
      items: catalog && Array.isArray(catalog.items) ? catalog.items : [],
    }];
  }

  function flattenArtifacts(catalog) {
    function flattenGroup(group) {
      var nested = Array.isArray(group.groups) ? group.groups.reduce(function (items, child) {
        return items.concat(flattenGroup(child));
      }, []) : [];
      var ownItems = Array.isArray(group.items) ? group.items : [];
      if (nested.length > 0) {
        var nestedIds = new Set(nested.map(function (item) {
          return item && item.id;
        }));
        ownItems = ownItems.filter(function (item) {
          return item && !nestedIds.has(item.id);
        });
      }
      return nested.concat(ownItems);
    }
    return artifactGroups(catalog).reduce(function (items, group) {
      return items.concat(flattenGroup(group));
    }, []);
  }

  function selectedArtifact() {
    var items = state.artifacts.catalog ? flattenArtifacts(state.artifacts.catalog) : [];
    return items.find(function (item) {
      return item && item.id === state.artifacts.selectedId;
    }) || null;
  }

  function artifactReference(item) {
    return item && (item.relativePath || item.logicalKey || item.id) || "";
  }

  function artifactDisplayTitle(item) {
    return item && (item.title || item.logicalKey || item.relativePath || item.id) || "Untitled artifact";
  }

  function formatArtifactBytes(value) {
    if (!Number.isFinite(value)) {
      return "Unknown size";
    }
    var bytes = Math.max(0, value);
    if (bytes < 1024) {
      return String(bytes) + " B";
    }
    var units = ["KB", "MB", "GB"];
    var size = bytes / 1024;
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size = size / 1024;
      index += 1;
    }
    return (size >= 10 ? size.toFixed(0) : size.toFixed(1)).replace(/\.0$/, "") + " " + units[index];
  }

  function artifactKind(item) {
    return item && item.kind ? String(item.kind) : "unknown";
  }

  function currentArtifactRunIds(explorer) {
    if (explorer && Array.isArray(explorer.runIds) && explorer.runIds.length > 0) {
      return explorer.runIds.filter(Boolean);
    }
    return explorer && explorer.runId ? [explorer.runId] : [];
  }

  function chooseDefaultArtifact(items, explorer) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    var currentRunIds = new Set(currentArtifactRunIds(explorer));
    var best = null;
    var bestScore = Infinity;
    items.forEach(function (item, index) {
      var runScore = currentRunIds.size > 0 && item && currentRunIds.has(item.runId) ? 0 : 1;
      var score = runScore * 100000 + artifactUsefulnessScore(item) * 1000 + index;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    });
    return best;
  }

  function artifactUsefulnessScore(item) {
    var role = String(item && item.role || "").toLowerCase();
    var haystack = [
      item && item.logicalKey,
      item && item.relativePath,
      item && item.title,
      item && item.id,
    ].filter(Boolean).join(" ").toLowerCase();
    if (role.indexOf("design") !== -1 || /\bdesign\b/.test(haystack)) return 0;
    if (role.indexOf("plan") !== -1 || /\bplan\b/.test(haystack)) return 1;
    if (role.indexOf("review") !== -1 || /\breview\b/.test(haystack)) return 2;
    if (role === "qa" || role.indexOf("qa") !== -1 || /\bqa\b/.test(haystack)) return 3;
    if (role.indexOf("ready-to-merge") !== -1 || haystack.indexOf("ready-to-merge") !== -1) return 4;
    if (isDiagnosticArtifact(role, haystack)) return 100;
    return 50;
  }

  function isDiagnosticArtifact(role, haystack) {
    return role.indexOf("diagnostic") !== -1
      || role.indexOf("internal") !== -1
      || /\b(log|trace|debug|diagnostic|diagnostics|internal)\b/.test(haystack)
      || haystack.indexOf("manifest-history") !== -1
      || haystack.indexOf("restart-archives") !== -1
      || haystack.indexOf("artifact-index") !== -1;
  }

  function fetchArtifacts(explorer) {
    if (!explorer.scopeKey) {
      state.artifacts.error = "Artifact scope is not available.";
      renderArtifactList(explorer);
      return;
    }
    state.artifacts.loading = true;
    renderArtifactList(explorer);
    fetch(artifactApiUrl(explorer))
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.message ? body.message : "Artifact catalog request failed.");
          }
          return body;
        });
      })
      .then(function (catalog) {
        state.artifacts.catalog = catalog;
        state.artifacts.error = null;
        state.artifacts.loading = false;
        var items = flattenArtifacts(catalog);
        var selectedStillExists = items.some(function (item) {
          return item && item.id === state.artifacts.selectedId;
        });
        if (!selectedStillExists) {
          var defaultItem = chooseDefaultArtifact(items, explorer);
          state.artifacts.selectedId = defaultItem ? defaultItem.id : null;
          state.artifacts.preview = null;
          if (defaultItem) {
            previewArtifact(explorer, defaultItem);
          }
        }
        renderArtifactList(explorer);
        renderArtifactPreview(explorer);
      })
      .catch(function (error) {
        state.artifacts.catalog = null;
        state.artifacts.error = error.message || "Artifact catalog request failed.";
        state.artifacts.loading = false;
        renderArtifactList(explorer);
        renderArtifactPreview(explorer);
      });
  }

  function renderArtifactList(explorer) {
    elements.artifactList.innerHTML = "";
    if (state.artifacts.loading) {
      elements.artifactList.append(artifactEmpty("Loading artifacts..."));
      return;
    }
    if (state.artifacts.error) {
      elements.artifactList.append(artifactEmpty(state.artifacts.error));
      return;
    }
    var catalog = state.artifacts.catalog;
    if (!catalog) {
      elements.artifactList.append(artifactEmpty("Artifacts have not been loaded yet."));
      return;
    }
    var groups = artifactGroups(catalog);
    var rendered = 0;
    groups.forEach(function (group) {
      var renderedGroup = renderArtifactGroup(explorer, group, 0);
      rendered += renderedGroup.count;
      if (renderedGroup.element) {
        elements.artifactList.append(renderedGroup.element);
      }
    });
    if (rendered === 0) {
      elements.artifactList.append(artifactEmpty("No artifacts were found for the current scope."));
    }
  }

  function renderArtifactGroup(explorer, group, depth) {
    var childGroups = Array.isArray(group.groups) ? group.groups : [];
    var nestedIds = new Set();
    childGroups.forEach(function (child) {
      (Array.isArray(child.items) ? child.items : []).forEach(function (item) {
        if (item && item.id) nestedIds.add(item.id);
      });
    });
    var items = (Array.isArray(group.items) ? group.items : []).filter(function (item) {
      return item && !nestedIds.has(item.id);
    });
    var section = document.createElement("section");
    section.className = depth > 0 ? "artifact-group artifact-subgroup" : "artifact-group";
    var title = document.createElement(depth > 0 ? "h4" : "h3");
    title.textContent = group.title || "Artifacts";
    section.append(title);
    var count = 0;
    childGroups.forEach(function (child) {
      var renderedChild = renderArtifactGroup(explorer, child, depth + 1);
      count += renderedChild.count;
      if (renderedChild.element) {
        section.append(renderedChild.element);
      }
    });
    items.forEach(function (item) {
      count += 1;
      section.append(renderArtifactRow(explorer, item));
    });
    return { element: count > 0 ? section : null, count: count };
  }

  function renderArtifactRow(explorer, item) {
    var row = document.createElement("article");
    row.className = "artifact-row" + (state.artifacts.selectedId === item.id ? " selected" : "");
    row.dataset.artifactId = item.id || "";
    var details = document.createElement("button");
    details.type = "button";
    details.className = "artifact-row-main";
    details.setAttribute("aria-pressed", state.artifacts.selectedId === item.id ? "true" : "false");
    details.addEventListener("click", function () {
      previewArtifact(explorer, item);
    });
    var title = document.createElement("strong");
    title.textContent = artifactDisplayTitle(item);
    var meta = document.createElement("span");
    meta.className = "artifact-row-meta";
    var kind = document.createElement("span");
    kind.textContent = artifactKind(item);
    var size = document.createElement("span");
    size.textContent = formatArtifactBytes(item.sizeBytes);
    var reference = document.createElement("span");
    reference.textContent = artifactReference(item);
    meta.append(kind, size, reference);
    details.append(title, meta);

    var actions = document.createElement("div");
    actions.className = "artifact-row-actions";
    var raw = document.createElement("a");
    raw.href = artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/raw");
    raw.target = "_blank";
    raw.rel = "noopener noreferrer";
    raw.textContent = "Raw";
    var download = document.createElement("a");
    download.href = artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/download");
    download.textContent = "Download";
    actions.append(raw, download);
    row.append(details, actions);
    return row;
  }

  function artifactEmpty(message) {
    var empty = document.createElement("div");
    empty.className = "artifact-empty";
    empty.textContent = message;
    return empty;
  }

  function previewArtifact(explorer, item) {
    var requestId = state.artifacts.previewRequestId + 1;
    state.artifacts.previewRequestId = requestId;
    state.artifacts.selectedId = item.id;
    state.artifacts.actionStatus = null;
    state.artifacts.actionStatusFailed = false;
    if (artifactKind(item) === "binary" || artifactKind(item) === "unknown") {
      state.artifacts.preview = {
        artifactId: item.id,
        loading: false,
        placeholder: true,
        renderKind: artifactKind(item),
        kind: artifactKind(item),
        artifact: item,
        sizeBytes: item.sizeBytes,
        loadedBytes: 0,
        content: "",
      };
      renderArtifactList(explorer);
      renderArtifactPreview(explorer);
      return;
    }
    state.artifacts.preview = {
      artifactId: item.id,
      loading: true,
      content: "Loading preview...",
      renderKind: artifactKind(item),
      kind: artifactKind(item),
      artifact: item,
    };
    renderArtifactList(explorer);
    renderArtifactPreview(explorer);
    fetch(artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/preview"))
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.message ? body.message : "Artifact preview request failed.");
          }
          return body;
        });
      })
      .then(function (preview) {
        if (requestId !== state.artifacts.previewRequestId || state.artifacts.selectedId !== item.id) {
          return;
        }
        state.artifacts.preview = {
          artifactId: item.id,
          loading: false,
          content: preview.content || "",
          truncated: preview.truncated,
          renderKind: preview.renderKind || preview.kind || artifactKind(item),
          kind: preview.kind || preview.renderKind || artifactKind(item),
          artifact: preview.artifact || item,
          sizeBytes: Number.isFinite(preview.sizeBytes) ? preview.sizeBytes : item.sizeBytes,
          loadedBytes: Number.isFinite(preview.loadedBytes) ? preview.loadedBytes : null,
          jsonParseSafe: preview.jsonParseSafe,
          title: preview.artifact && preview.artifact.title ? preview.artifact.title : item.title,
        };
        renderArtifactPreview(explorer);
      })
      .catch(function (error) {
        if (requestId !== state.artifacts.previewRequestId || state.artifacts.selectedId !== item.id) {
          return;
        }
        state.artifacts.preview = {
          artifactId: item.id,
          loading: false,
          content: error.message || "Artifact preview request failed.",
          renderKind: artifactKind(item),
          kind: artifactKind(item),
          artifact: item,
          error: true,
        };
        renderArtifactPreview(explorer);
      });
  }

  function renderArtifactPreview(explorer) {
    var item = selectedArtifact();
    renderArtifactToolbar(explorer, item);
    var preview = state.artifacts.preview;
    if (!item) {
      elements.artifactSelectedTitle.textContent = "Preview";
      elements.artifactSelectedMeta.textContent = "Select an artifact to preview it.";
      renderPreviewMessage("Select an artifact to preview it.", false);
      return;
    }
    elements.artifactSelectedTitle.textContent = artifactDisplayTitle(item);
    elements.artifactSelectedMeta.textContent = [
      artifactKind(item),
      formatArtifactBytes(item.sizeBytes),
      artifactReference(item),
    ].filter(Boolean).join(" | ");
    if (!preview) {
      renderPreviewMessage("Select an artifact to preview it.", false);
      return;
    }
    renderArtifactPreviewContent(explorer, item, preview);
  }

  function resetPreviewContainer() {
    elements.artifactPreview.textContent = "";
    elements.artifactPreview.className = "artifact-preview-content text-panel compact";
  }

  function renderPreviewMessage(message, failed) {
    resetPreviewContainer();
    elements.artifactPreview.classList.toggle("error-text", Boolean(failed));
    elements.artifactPreview.textContent = message;
  }

  function renderArtifactPreviewContent(explorer, item, preview) {
    if (preview.loading) {
      renderPreviewMessage("Loading preview...", false);
      return;
    }
    if (preview.error) {
      renderPreviewMessage(preview.content || "Artifact preview request failed.", true);
      return;
    }

    resetPreviewContainer();
    var renderKind = String(preview.renderKind || preview.kind || artifactKind(item));
    if (renderKind === "markdown") {
      renderMarkdownPreview(elements.artifactPreview, preview);
    } else if (renderKind === "json") {
      renderJsonPreview(explorer, elements.artifactPreview, item, preview);
    } else if (renderKind === "diff") {
      renderTextPreview(elements.artifactPreview, preview, "Diff preview");
    } else if (renderKind === "text") {
      renderTextPreview(elements.artifactPreview, preview, "");
    } else {
      renderArtifactPlaceholder(explorer, elements.artifactPreview, item, preview);
    }
    renderTruncationStatus(elements.artifactPreview, preview);
  }

  function renderTextPreview(container, preview, label) {
    if (label) {
      var badge = document.createElement("div");
      badge.className = "artifact-kind-label";
      badge.textContent = label;
      container.append(badge);
    }
    var block = document.createElement("pre");
    block.className = "artifact-text-preview";
    block.textContent = preview.content || "";
    container.append(block);
  }

  function renderJsonPreview(explorer, container, item, preview) {
    var viewer = document.createElement("div");
    viewer.className = "artifact-json-viewer";
    var controls = document.createElement("div");
    controls.className = "artifact-preview-modes";
    var artifactId = item.id || "";
    var mode = state.artifacts.viewerModes[artifactId] || "pretty";
    ["pretty", "raw"].forEach(function (nextMode) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = nextMode === "pretty" ? "Pretty" : "Raw";
      button.className = mode === nextMode ? "primary" : "";
      button.setAttribute("aria-pressed", mode === nextMode ? "true" : "false");
      button.addEventListener("click", function () {
        state.artifacts.viewerModes[artifactId] = nextMode;
        renderArtifactPreview(explorer);
      });
      controls.append(button);
    });
    viewer.append(controls);

    var block = document.createElement("pre");
    block.className = "artifact-text-preview artifact-json-preview";
    var raw = preview.content || "";
    if (mode === "raw") {
      block.textContent = raw;
      viewer.append(block);
      container.append(viewer);
      return;
    }

    if (preview.truncated || preview.jsonParseSafe === false) {
      viewer.append(previewWarning("JSON Pretty is unavailable for truncated or unsafe previews. Raw preview is shown."));
      block.textContent = raw;
      viewer.append(block);
      container.append(viewer);
      return;
    }

    try {
      block.textContent = JSON.stringify(JSON.parse(raw), null, 2);
    } catch (error) {
      viewer.append(previewWarning("JSON parse error: " + (error && error.message ? error.message : "invalid JSON.")));
      block.textContent = raw;
    }
    viewer.append(block);
    container.append(viewer);
  }

  function previewWarning(message) {
    var warning = document.createElement("div");
    warning.className = "artifact-preview-warning";
    warning.textContent = message;
    return warning;
  }

  function renderArtifactPlaceholder(explorer, container, item, preview) {
    var panel = document.createElement("div");
    panel.className = "artifact-placeholder";
    var title = document.createElement("strong");
    title.textContent = artifactKind(item) === "binary" ? "Binary artifact" : "Preview unavailable";
    var meta = document.createElement("dl");
    appendPlaceholderMeta(meta, "Kind", artifactKind(item));
    appendPlaceholderMeta(meta, "Path", artifactReference(item) || item.id || "Unknown");
    appendPlaceholderMeta(meta, "Size", formatArtifactBytes(Number.isFinite(preview.sizeBytes) ? preview.sizeBytes : item.sizeBytes));
    var actions = document.createElement("div");
    actions.className = "artifact-placeholder-actions";
    var raw = document.createElement("a");
    raw.href = artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/raw");
    raw.target = "_blank";
    raw.rel = "noopener noreferrer";
    raw.textContent = "Open raw";
    var download = document.createElement("a");
    download.href = artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/download");
    download.textContent = "Download";
    actions.append(raw, download);
    panel.append(title, meta, actions);
    container.append(panel);
  }

  function appendPlaceholderMeta(list, label, value) {
    var term = document.createElement("dt");
    term.textContent = label;
    var detail = document.createElement("dd");
    detail.textContent = value || "";
    list.append(term, detail);
  }

  function renderTruncationStatus(container, preview) {
    if (!preview.truncated) {
      return;
    }
    var status = document.createElement("div");
    status.className = "artifact-truncation";
    var loaded = Number.isFinite(preview.loadedBytes) ? preview.loadedBytes : 0;
    var total = Number.isFinite(preview.sizeBytes) ? preview.sizeBytes : loaded;
    status.textContent = "Preview truncated: loaded " + formatArtifactBytes(loaded) + " of " + formatArtifactBytes(total) + ".";
    container.append(status);
  }

  function renderMarkdownPreview(container, preview) {
    var root = document.createElement("div");
    root.className = "artifact-rendered-markdown";
    appendMarkdownBlocks(root, preview.content || "");
    container.append(root);
  }

  function appendMarkdownBlocks(container, markdown) {
    var lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    var index = 0;
    while (index < lines.length) {
      var line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }

      var fence = line.match(/^\s*(```+|~~~+)\s*([^\s`]*)\s*$/);
      if (fence) {
        var marker = fence[1];
        var codeLines = [];
        index += 1;
        while (index < lines.length && lines[index].trim() !== marker) {
          codeLines.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        var pre = document.createElement("pre");
        var code = document.createElement("code");
        if (fence[2]) {
          code.dataset.language = fence[2];
        }
        code.textContent = codeLines.join("\n");
        pre.append(code);
        container.append(pre);
        continue;
      }

      if (isMarkdownTable(lines, index)) {
        var tableResult = renderMarkdownTable(lines, index);
        container.append(tableResult.table);
        index = tableResult.nextIndex;
        continue;
      }

      var heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        var headingNode = document.createElement("h" + heading[1].length);
        appendInlineMarkdown(headingNode, heading[2]);
        container.append(headingNode);
        index += 1;
        continue;
      }

      var listMatch = line.match(/^\s{0,3}((?:[-*+])|(?:\d+[.)]))\s+(.+)$/);
      if (listMatch) {
        var ordered = /\d/.test(listMatch[1]);
        var list = document.createElement(ordered ? "ol" : "ul");
        while (index < lines.length) {
          var current = lines[index].match(/^\s{0,3}((?:[-*+])|(?:\d+[.)]))\s+(.+)$/);
          if (!current || /\d/.test(current[1]) !== ordered) {
            break;
          }
          var item = document.createElement("li");
          appendInlineMarkdown(item, current[2]);
          list.append(item);
          index += 1;
        }
        container.append(list);
        continue;
      }

      var paragraphLines = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      var paragraph = document.createElement("p");
      appendInlineMarkdown(paragraph, paragraphLines.join(" "));
      container.append(paragraph);
    }
  }

  function isMarkdownBlockStart(lines, index) {
    var line = lines[index] || "";
    return /^\s*(```+|~~~+)/.test(line)
      || /^\s{0,3}#{1,6}\s+/.test(line)
      || /^\s{0,3}((?:[-*+])|(?:\d+[.)]))\s+/.test(line)
      || isMarkdownTable(lines, index);
  }

  function isMarkdownTable(lines, index) {
    return index + 1 < lines.length
      && lines[index].indexOf("|") !== -1
      && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || "");
  }

  function splitMarkdownTableRow(line) {
    var value = String(line || "").trim();
    if (value.charAt(0) === "|") value = value.slice(1);
    if (value.charAt(value.length - 1) === "|") value = value.slice(0, -1);
    return value.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function renderMarkdownTable(lines, startIndex) {
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var tbody = document.createElement("tbody");
    var headerRow = document.createElement("tr");
    splitMarkdownTableRow(lines[startIndex]).forEach(function (cell) {
      var th = document.createElement("th");
      appendInlineMarkdown(th, cell);
      headerRow.append(th);
    });
    thead.append(headerRow);
    var index = startIndex + 2;
    while (index < lines.length && lines[index].indexOf("|") !== -1 && lines[index].trim()) {
      var row = document.createElement("tr");
      splitMarkdownTableRow(lines[index]).forEach(function (cell) {
        var td = document.createElement("td");
        appendInlineMarkdown(td, cell);
        row.append(td);
      });
      tbody.append(row);
      index += 1;
    }
    table.append(thead, tbody);
    return { table: table, nextIndex: index };
  }

  function appendInlineMarkdown(parent, value) {
    var source = String(value || "");
    var pattern = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
    var cursor = 0;
    var match;
    while ((match = pattern.exec(source))) {
      if (match.index > cursor) {
        parent.append(document.createTextNode(source.slice(cursor, match.index)));
      }
      if (match[1]) {
        var code = document.createElement("code");
        code.textContent = match[1].slice(1, -1);
        parent.append(code);
      } else {
        var href = safeMarkdownHref(match[4]);
        if (href) {
          var link = document.createElement("a");
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = match[3];
          parent.append(link);
        } else {
          parent.append(document.createTextNode(match[0]));
        }
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < source.length) {
      parent.append(document.createTextNode(source.slice(cursor)));
    }
  }

  function safeMarkdownHref(value) {
    var raw = String(value || "").trim();
    try {
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        return parsed.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  function renderArtifactToolbar(explorer, item) {
    var preview = state.artifacts.preview;
    var hasItem = Boolean(item);
    var hasContent = hasItem && preview && !preview.loading && !preview.error && typeof preview.content === "string";
    elements.artifactCopyContent.disabled = !hasContent;
    elements.artifactCopyReference.disabled = !hasItem;
    setArtifactActionLink(elements.artifactOpenRaw, hasItem ? artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/raw") : "");
    setArtifactActionLink(elements.artifactDownload, hasItem ? artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/download") : "");
    elements.artifactActionStatus.textContent = state.artifacts.actionStatus || "";
    elements.artifactActionStatus.classList.toggle("error-text", Boolean(state.artifacts.actionStatusFailed));
  }

  function setArtifactActionLink(link, href) {
    if (href) {
      link.href = href;
      link.classList.remove("disabled");
      link.setAttribute("aria-disabled", "false");
    } else {
      link.removeAttribute("href");
      link.classList.add("disabled");
      link.setAttribute("aria-disabled", "true");
    }
  }

  function setArtifactActionStatus(message, failed) {
    state.artifacts.actionStatus = message;
    state.artifacts.actionStatusFailed = Boolean(failed);
    elements.artifactActionStatus.textContent = message || "";
    elements.artifactActionStatus.classList.toggle("error-text", Boolean(failed));
    if (failed && message) {
      appendLog("[artifacts] " + message);
    }
  }

  function writeClipboard(value, successMessage) {
    if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      setArtifactActionStatus("Clipboard is not available in this browser.", true);
      return Promise.resolve(false);
    }
    return navigator.clipboard.writeText(value).then(function () {
      setArtifactActionStatus(successMessage, false);
      return true;
    }).catch(function (error) {
      setArtifactActionStatus("Clipboard copy failed: " + (error && error.message ? error.message : "permission denied."), true);
      return false;
    });
  }

  function copySelectedArtifactContent() {
    var preview = state.artifacts.preview;
    if (!preview || preview.loading || preview.error || typeof preview.content !== "string") {
      setArtifactActionStatus("Preview content is not ready to copy.", true);
      return;
    }
    writeClipboard(preview.content, "Copied artifact preview content.");
  }

  function copySelectedArtifactReference() {
    var item = selectedArtifact();
    if (!item) {
      setArtifactActionStatus("No artifact is selected.", true);
      return;
    }
    writeClipboard(artifactReference(item), "Copied artifact path/reference.");
  }

  function renderModal(vm) {
    var nextSignature = modalSignature(vm);
    if (state.modalSignature === nextSignature) {
      return;
    }
    state.modalSignature = nextSignature;
    elements.modalRoot.innerHTML = "";
    if (vm.confirmation) {
      elements.modalRoot.append(renderConfirmation(vm.confirmation));
      return;
    }
    if (vm.confirmText) {
      elements.modalRoot.append(renderConfirmation({
        kind: "run",
        text: vm.confirmText,
        actions: ["ok", "cancel"],
        selectedAction: "ok",
      }));
      return;
    }
    if (vm.form) {
      elements.modalRoot.append(renderForm(vm.form));
    }
  }

  function rerenderModal() {
    state.modalSignature = null;
    renderModal(state.viewModel || {});
  }

  function modalSignature(vm) {
    if (vm.confirmation) {
      return stableJson({
        type: "confirmation",
        kind: vm.confirmation.kind,
        flowId: vm.confirmation.flowId,
        text: vm.confirmation.text,
        actions: vm.confirmation.actions,
        selectedAction: vm.confirmation.selectedAction,
      });
    }
    if (vm.confirmText) {
      return stableJson({
        type: "legacy-confirmation",
        text: vm.confirmText,
      });
    }
    if (vm.form) {
      var definition = vm.form.definition || {};
      return stableJson({
        type: "form",
        formId: vm.form.formId,
        title: vm.form.title || definition.title,
        description: definition.description || "",
        footer: vm.form.footer,
        error: vm.form.error,
        submitLabel: definition.submitLabel,
        preview: definition.preview,
        fields: vm.form.fields || definition.fields || [],
      });
    }
    return "none";
  }

  function stableJson(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(Date.now());
    }
  }

  function renderConfirmation(confirmation) {
    var modal = createModal("Confirm " + text(confirmation.kind, "action"), confirmation.text || "");
    var body = modal.querySelector(".modal-body");
    var selected = document.createElement("p");
    selected.className = "modal-note";
    selected.textContent = "Selected action: " + text(confirmation.selectedAction, "none");
    body.append(selected);

    var actions = Array.isArray(confirmation.actions) && confirmation.actions.length > 0 ? confirmation.actions : ["ok", "cancel"];
    var footerActions = modal.querySelector(".modal-actions");
    actions.forEach(function (name) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = name === confirmation.selectedAction ? "primary" : "";
      if (name === "stop") button.className = "danger";
      button.textContent = name === "ok" ? "OK" : name.charAt(0).toUpperCase() + name.slice(1);
      button.addEventListener("click", function () {
        api.selectAndAcceptConfirmation(name);
      });
      footerActions.append(button);
    });
    if (actions.indexOf("cancel") === -1) {
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", function () {
        api.send({ type: "confirm.cancel" });
      });
      footerActions.append(cancel);
    }
    return modal;
  }

  function createModal(title, note) {
    var modal = document.createElement("section");
    modal.className = "modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    var header = document.createElement("div");
    header.className = "modal-header";
    var heading = document.createElement("h2");
    heading.textContent = title;
    var paragraph = document.createElement("p");
    paragraph.textContent = note || "";
    header.append(heading, paragraph);

    var body = document.createElement("div");
    body.className = "modal-body";
    var footer = document.createElement("div");
    footer.className = "modal-footer";
    var footerNote = document.createElement("span");
    footerNote.className = "modal-note";
    footerNote.textContent = "";
    var actions = document.createElement("div");
    actions.className = "modal-actions";
    footer.append(footerNote, actions);
    modal.append(header, body, footer);
    return modal;
  }

  function renderForm(formModel) {
    var definition = formModel.definition || {};
    var modal = createModal(text(formModel.title || definition.title, "Input required"), text(definition.description, ""));
    modal.classList.add("form-" + classNameToken(formModel.formId || definition.formId || "unknown"));
    var body = modal.querySelector(".modal-body");
    var footerNote = modal.querySelector(".modal-note");
    var footerActions = modal.querySelector(".modal-actions");

    if (definition.preview) {
      var preview = document.createElement("pre");
      preview.className = "text-panel compact";
      preview.textContent = definition.preview;
      body.append(preview);
    }

    if (formModel.error) {
      var error = document.createElement("div");
      error.className = "error-text";
      error.textContent = formModel.error;
      body.append(error);
    }

    var fields = document.createElement("div");
    fields.className = "form-fields";
    if ((formModel.formId || definition.formId) === "flow-routing-editor") {
      fields.classList.add("route-fields");
    }
    appendRenderedFields(fields, formModel.fields || definition.fields || [], (formModel.formId || definition.formId) === "flow-routing-editor");
    body.append(fields);

    footerNote.textContent = text(formModel.footer, "");
    var submit = document.createElement("button");
    submit.type = "button";
    submit.className = "primary";
    submit.textContent = text(definition.submitLabel, "Submit");
    submit.addEventListener("click", api.submitForm);
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", api.cancelForm);
    footerActions.append(submit, cancel);
    return modal;
  }

  function appendRenderedFields(container, fields, pairExecutorModelFields) {
    var index = 0;
    while (index < fields.length) {
      var field = fields[index];
      var next = fields[index + 1];
      if (pairExecutorModelFields && isExecutorModelPair(field, next)) {
        var pair = document.createElement("div");
        pair.className = "field-pair executor-model-pair";
        pair.dataset.routeKey = field.id.slice(0, -"executor".length).replace(/_$/, "");
        pair.append(renderField(field), renderField(next));
        container.append(pair);
        index += 2;
        continue;
      }
      container.append(renderField(field));
      index += 1;
    }
  }

  function isExecutorModelPair(field, next) {
    return Boolean(
      field
      && next
      && field.type === "single-select"
      && next.type === "single-select"
      && typeof field.id === "string"
      && typeof next.id === "string"
      && field.id.endsWith("_executor")
      && next.id === field.id.slice(0, -"executor".length) + "model",
    );
  }

  function classNameToken(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  }

  function currentValue(field) {
    if (Object.prototype.hasOwnProperty.call(state.formValues, field.id)) {
      return state.formValues[field.id];
    }
    if (Object.prototype.hasOwnProperty.call(field, "default")) {
      return field.default;
    }
    if (field.type === "boolean") return false;
    if (field.type === "multi-select") return [];
    if (field.type === "single-select") return field.options && field.options[0] ? field.options[0].value : "";
    if (field.type === "text-file") return null;
    return "";
  }

  function normalizeTextFileExtension(value) {
    var normalized = String(value || "").trim().replace(/^\./, "").toLowerCase();
    return ["md", "markdown", "txt", "xml"].indexOf(normalized) === -1 ? "" : normalized;
  }

  function extensionFromFileName(name) {
    var match = /\.([^.]+)$/.exec(String(name || ""));
    return match ? normalizeTextFileExtension(match[1]) : "";
  }

  function inferTextFileMediaType(extension, reportedType) {
    var type = String(reportedType || "").trim().toLowerCase();
    if (["text/plain", "text/markdown", "text/xml", "application/xml"].indexOf(type) !== -1) {
      return type;
    }
    if (extension === "md" || extension === "markdown") return "text/markdown";
    if (extension === "xml") return "text/xml";
    return "text/plain";
  }

  function textFileMaxBytes(field) {
    var max = Number(field && field.maxBytes);
    return Number.isFinite(max) && max > 0 ? max : 524288;
  }

  function textFileAccept(field) {
    var accept = Array.isArray(field.accept) ? field.accept : [".md", ".markdown", ".txt", ".xml"];
    return accept.filter(function (item) { return typeof item === "string" && item.trim(); }).join(",");
  }

  function normalizeTextFileContent(content) {
    return String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function utf8ByteLength(value) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(value).length;
    }
    return unescape(encodeURIComponent(value)).length;
  }

  function fallbackSha256() {
    return "0".repeat(64);
  }

  async function sha256Text(content) {
    var cryptoApi = window.crypto || window.msCrypto;
    if (!cryptoApi || !cryptoApi.subtle || typeof TextEncoder === "undefined") {
      return fallbackSha256();
    }
    var digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function renderField(field) {
    var wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.dataset.fieldId = field.id;
    wrapper.dataset.fieldType = field.type;

    if (field.type === "boolean") {
      var checkRow = document.createElement("label");
      checkRow.className = "check-row";
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = "field-" + field.id;
      checkbox.name = field.id;
      checkbox.dataset.fieldId = field.id;
      checkbox.dataset.fieldType = field.type;
      checkbox.checked = currentValue(field) === true;
      checkbox.addEventListener("change", function () {
        updateField(field.id, checkbox.checked);
      });
      checkRow.append(checkbox, document.createTextNode(field.label + (field.required ? " *" : "")));
      wrapper.append(checkRow);
    } else {
      var label = document.createElement("label");
      label.setAttribute("for", "field-" + field.id);
      label.textContent = field.label + (field.required ? " *" : "");
      wrapper.append(label);
      if (field.type === "text") {
        var input = document.createElement(field.multiline ? "textarea" : "input");
        input.id = "field-" + field.id;
        if (!field.multiline) input.type = "text";
        input.name = field.id;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.rows) input.rows = field.rows;
        input.dataset.fieldId = field.id;
        input.dataset.fieldType = field.type;
        input.value = String(currentValue(field) || "");
        input.addEventListener("input", function () {
          updateField(field.id, input.value);
        });
        wrapper.append(input);
      } else if (field.type === "single-select") {
        wrapper.append(renderSingleSelect(field));
      } else if (field.type === "multi-select") {
        wrapper.append(renderMultiSelect(field));
      } else if (field.type === "text-file") {
        wrapper.append(renderTextFileField(field));
      }
    }

    if (field.help) {
      var help = document.createElement("div");
      help.className = "field-help";
      help.textContent = field.help;
      wrapper.append(help);
    }
    return wrapper;
  }

  function renderTextFileField(field) {
    var container = document.createElement("div");
    container.className = "text-file-field";
    var controls = document.createElement("div");
    controls.className = "text-file-controls";
    var input = document.createElement("input");
    input.type = "file";
    input.id = "field-" + field.id;
    input.name = field.id;
    input.accept = textFileAccept(field);
    input.dataset.fieldId = field.id;
    input.dataset.fieldType = field.type;
    var uploadButton = document.createElement("label");
    uploadButton.className = "text-file-button";
    uploadButton.setAttribute("for", input.id);
    uploadButton.textContent = text(field.buttonLabel, "Upload file");
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-file-remove";
    remove.textContent = "Remove";
    var status = document.createElement("div");
    status.className = "text-file-status";
    var value = currentValue(field);
    var hasFile = value && typeof value === "object" && value.kind === "text-file";
    remove.disabled = !hasFile;
    remove.addEventListener("click", function () {
      input.value = "";
      updateField(field.id, null);
      rerenderModal();
    });
    input.addEventListener("change", async function () {
      var file = input.files && input.files[0];
      if (!file) {
        updateField(field.id, null);
        rerenderModal();
        return;
      }
      var extension = extensionFromFileName(file.name);
      if (!extension) {
        status.textContent = "Unsupported file type.";
        return;
      }
      if (Number(file.size) > textFileMaxBytes(field)) {
        status.textContent = "File is larger than " + formatArtifactBytes(textFileMaxBytes(field)) + ".";
        return;
      }
      var rawContent = await file.text();
      var content = normalizeTextFileContent(rawContent);
      if (!content.trim()) {
        status.textContent = "File is empty.";
        return;
      }
      if (content.indexOf("\0") !== -1) {
        status.textContent = "Binary files are not supported.";
        return;
      }
      var next = {
        kind: "text-file",
        name: String(file.name || "task-source." + extension),
        mediaType: inferTextFileMediaType(extension, file.type),
        extension: extension,
        sizeBytes: utf8ByteLength(content),
        sha256: await sha256Text(content),
        content: content,
      };
      updateField(field.id, next);
      rerenderModal();
    });
    controls.append(input, uploadButton, remove);
    container.append(controls, status);
    if (hasFile) {
      var meta = document.createElement("div");
      meta.className = "text-file-meta";
      meta.textContent = [
        value.name,
        formatArtifactBytes(Number(value.sizeBytes) || 0),
        value.mediaType || "text/plain",
      ].filter(Boolean).join(" · ");
      container.append(meta);
      if (typeof value.content === "string" && value.content.length > 0) {
        var preview = document.createElement("pre");
        preview.className = "text-file-preview";
        preview.textContent = value.content.slice(0, 1200);
        container.append(preview);
      }
    }
    return container;
  }

  function renderSingleSelect(field) {
    var list = document.createElement("div");
    list.className = "option-list";
    var value = String(currentValue(field) || "");
    (field.options || []).forEach(function (option) {
      var label = document.createElement("label");
      label.className = "field-option";
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "field-" + field.id;
      input.id = controlId("field", field.id, option.value);
      input.value = option.value;
      input.dataset.fieldId = field.id;
      input.dataset.fieldType = field.type;
      input.checked = option.value === value;
      input.addEventListener("change", function () {
        if (input.checked) updateField(field.id, option.value);
      });
      var textWrap = document.createElement("span");
      textWrap.append(document.createTextNode(option.label));
      if (option.description) {
        var description = document.createElement("small");
        description.textContent = option.description;
        textWrap.append(document.createElement("br"), description);
      }
      label.append(input, textWrap);
      list.append(label);
    });
    return list;
  }

  function renderMultiSelect(field) {
    var list = document.createElement("div");
    list.className = "option-list";
    var value = currentValue(field);
    var selected = Array.isArray(value) ? value : [];
    (field.options || []).forEach(function (option) {
      var label = document.createElement("label");
      label.className = "field-option";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = controlId("field", field.id, option.value);
      input.name = field.id;
      input.value = option.value;
      input.dataset.fieldId = field.id;
      input.dataset.fieldType = field.type;
      input.checked = selected.indexOf(option.value) !== -1;
      input.addEventListener("change", function () {
        var next = collectMultiSelect(field.id);
        updateField(field.id, next);
      });
      var textWrap = document.createElement("span");
      textWrap.append(document.createTextNode(option.label));
      if (option.description) {
        var description = document.createElement("small");
        description.textContent = option.description;
        textWrap.append(document.createElement("br"), description);
      }
      label.append(input, textWrap);
      list.append(label);
    });
    return list;
  }

  function updateField(fieldId, value) {
    state.formValues[fieldId] = value;
    api.send({ type: "form.fieldUpdate", fieldId: fieldId, value: value });
  }

  function collectMultiSelect(fieldId) {
    return Array.prototype.slice.call(elements.modalRoot.querySelectorAll('[data-field-id="' + fieldId + '"] input[type="checkbox"]'))
      .filter(function (input) { return input.checked; })
      .map(function (input) { return input.value; });
  }

  function collectFormValues() {
    return Object.assign({}, state.formValues);
  }

  applyTheme(state.theme);
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener("click", toggleTheme);
  }
  if (elements.autoFlowResizer) {
    elements.autoFlowResizer.setAttribute("role", "separator");
    elements.autoFlowResizer.setAttribute("aria-orientation", "horizontal");
    elements.autoFlowResizer.setAttribute("aria-label", "Resize flow editor");
    elements.autoFlowResizer.setAttribute("tabindex", "0");
    elements.autoFlowResizer.addEventListener("pointerdown", beginAutoFlowResize);
    elements.autoFlowResizer.addEventListener("dblclick", resetAutoFlowHeight);
    elements.autoFlowResizer.addEventListener("keydown", handleAutoFlowResizerKeydown);
  }
  applyWorkspaceSplit(state.workspaceSplit);
  if (elements.workspaceResizer) {
    elements.workspaceResizer.setAttribute("role", "separator");
    elements.workspaceResizer.setAttribute("aria-orientation", "vertical");
    elements.workspaceResizer.setAttribute("aria-label", "Resize workspace panels");
    elements.workspaceResizer.setAttribute("tabindex", "0");
    elements.workspaceResizer.addEventListener("pointerdown", beginWorkspaceResize);
    elements.workspaceResizer.addEventListener("dblclick", resetWorkspaceSplit);
    elements.workspaceResizer.addEventListener("keydown", handleWorkspaceResizerKeydown);
  }
  applyLogAutoscroll(state.logAutoscroll);
  if (elements.logAutoscroll) {
    elements.logAutoscroll.addEventListener("change", function () {
      applyLogAutoscroll(elements.logAutoscroll.checked);
      persistLogAutoscroll(state.logAutoscroll);
    });
  }
  elements.run.addEventListener("click", api.openRunConfirm);
  elements.interrupt.addEventListener("click", api.openInterruptConfirm);
  elements.artifactOpen.addEventListener("click", api.openArtifactExplorer);
  elements.artifactClose.addEventListener("click", api.closeArtifactExplorer);
  elements.artifactToolbarClose.addEventListener("click", api.closeArtifactExplorer);
  elements.artifactCopyContent.addEventListener("click", copySelectedArtifactContent);
  elements.artifactCopyReference.addEventListener("click", copySelectedArtifactReference);
  ensureGitDiffModeButtons();
  elements.gitDiffClose.addEventListener("click", closeGitDiff);
  Array.prototype.slice.call(elements.gitDiffModeControls.querySelectorAll("button")).forEach(function (button) {
    button.addEventListener("click", function () {
      setGitDiffMode(button.dataset.gitDiffMode || "head");
    });
  });
  elements.gitRefresh.addEventListener("click", api.refreshGit);
  elements.gitCreateBranch.addEventListener("click", api.createGitBranch);
  elements.gitCheckout.addEventListener("click", api.checkoutGitBranch);
  elements.gitFetch.addEventListener("click", api.fetchGit);
  elements.gitPull.addEventListener("click", api.pullGit);
  elements.gitStage.addEventListener("click", api.stageGit);
  elements.gitUnstage.addEventListener("click", api.unstageGit);
  elements.gitCommit.addEventListener("click", api.commitGit);
  elements.gitPush.addEventListener("click", api.pushGit);
  elements.gitCommitMessage.addEventListener("input", function () {
    state.gitCommitMessage = elements.gitCommitMessage.value;
  });
  elements.gitCommitMessage.addEventListener("change", api.updateGitCommitMessage);
  elements.help.addEventListener("click", api.toggleHelp);
  elements.closeHelp.addEventListener("click", function () {
    api.showHelp(false);
  });
  elements.clearLog.addEventListener("click", api.clearLog);
  elements.progress.addEventListener("scroll", function () {
    sendScrollPane("progress", elements.progress);
  });
  elements.log.addEventListener("scroll", function () {
    sendScrollPane("log", elements.log);
  });
  elements.helpText.addEventListener("scroll", function () {
    sendScrollPane("help", elements.helpText);
  });

  api.connect();
}());
