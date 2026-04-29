(function () {
  "use strict";

  var state = {
    viewModel: null,
    connectionState: "connecting",
    formValues: {},
    modalSignature: null,
    artifacts: {
      signature: null,
      loading: false,
      catalog: null,
      error: null,
      preview: null,
      selectedId: null,
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
    flowsTitle: document.getElementById("flows-title"),
    flows: document.getElementById("flows-list"),
    description: document.getElementById("description-text"),
    progressTitle: document.getElementById("progress-title"),
    progress: document.getElementById("progress-text"),
    summaryTitle: document.getElementById("summary-title"),
    summary: document.getElementById("summary-text"),
    logTitle: document.getElementById("log-title"),
    log: document.getElementById("log-text"),
    clearLog: document.getElementById("clear-log-button"),
    artifactOpen: document.getElementById("artifact-open-button"),
    artifactDrawer: document.getElementById("artifact-drawer"),
    artifactClose: document.getElementById("artifact-close-button"),
    artifactTitle: document.getElementById("artifact-title"),
    artifactMeta: document.getElementById("artifact-meta"),
    artifactMessage: document.getElementById("artifact-message"),
    artifactList: document.getElementById("artifact-list"),
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

  function actionId() {
    return "web-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
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
      var uiState = captureUiState();
      state.viewModel = message.viewModel || {};
      state.formValues = state.viewModel.form ? Object.assign({}, state.viewModel.form.values || {}) : {};
      render();
      restoreUiState(uiState);
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

  function appendLog(lines) {
    if (!lines) return;
    var wasPinned = elements.log.scrollTop + elements.log.clientHeight >= elements.log.scrollHeight - 8;
    elements.log.textContent += (elements.log.textContent ? "\n" : "") + lines;
    if (wasPinned) {
      elements.log.scrollTop = elements.log.scrollHeight;
    }
  }

  function render() {
    var vm = state.viewModel || {};
    elements.title.textContent = text(vm.title, "AgentWeaver");
    elements.header.textContent = text(vm.header, "Local operator console");
    elements.status.textContent = text(vm.statusText, "Idle");
    elements.flowsTitle.textContent = text(vm.flowListTitle, "Flows");
    elements.description.textContent = text(vm.descriptionText, "No flow selected.");
    elements.progressTitle.textContent = text(vm.progressTitle, "Progress");
    setTextPreservingScroll(elements.progress, text(vm.progressText, "No progress yet."));
    elements.summaryTitle.textContent = text(vm.summaryTitle, "Task Summary");
    setTextPreservingScroll(elements.summary, vm.summaryVisible === false ? "Summary is hidden." : text(vm.summaryText, "No task summary yet."));
    elements.logTitle.textContent = text(vm.logTitle, "Activity");
    setTextPreservingScroll(elements.log, text(vm.logText, ""));
    elements.helpText.textContent = text(vm.helpText, "No help is available.");
    elements.helpPanel.hidden = !vm.helpVisible;
    elements.help.setAttribute("aria-pressed", vm.helpVisible ? "true" : "false");

    renderFlows(vm);
    renderModal(vm);
    renderArtifactExplorer(vm);
  }

  function setTextPreservingScroll(element, value) {
    if (element.textContent === value) {
      return;
    }
    var previousScrollTop = element.scrollTop;
    var wasPinned = previousScrollTop + element.clientHeight >= element.scrollHeight - 8;
    element.textContent = value;
    element.scrollTop = wasPinned ? element.scrollHeight : previousScrollTop;
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
      summaryScrollTop: elements.summary.scrollTop,
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
    elements.summary.scrollTop = uiState.summaryScrollTop;
    elements.log.scrollTop = uiState.logScrollTop;
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
      state.artifacts.catalog = null;
      state.artifacts.error = null;
      state.artifacts.preview = null;
      state.artifacts.selectedId = null;
      fetchArtifacts(explorer);
    }
    renderArtifactList(explorer);
    renderArtifactPreview();
  }

  function artifactMetaText(explorer) {
    var parts = [];
    if (explorer.scopeKey) {
      parts.push("Scope " + explorer.scopeKey);
    }
    if (explorer.runId) {
      parts.push("Run " + explorer.runId);
    }
    if (typeof explorer.artifactCount === "number") {
      parts.push(String(explorer.artifactCount) + " artifact" + (explorer.artifactCount === 1 ? "" : "s"));
    }
    return parts.join(" | ");
  }

  function artifactApiUrl(explorer, suffix) {
    var base = "/__agentweaver/api/artifacts" + (suffix || "");
    var params = new URLSearchParams();
    if (explorer.scopeKey) {
      params.set("scope", explorer.scopeKey);
    }
    if (explorer.runId) {
      params.set("runId", explorer.runId);
    }
    var query = params.toString();
    return query ? base + "?" + query : base;
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
        renderArtifactList(explorer);
      })
      .catch(function (error) {
        state.artifacts.catalog = null;
        state.artifacts.error = error.message || "Artifact catalog request failed.";
        state.artifacts.loading = false;
        renderArtifactList(explorer);
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
    var groups = Array.isArray(catalog.groups) && catalog.groups.length > 0
      ? catalog.groups
      : [{ title: "Artifacts", items: Array.isArray(catalog.items) ? catalog.items : [] }];
    var rendered = 0;
    groups.forEach(function (group) {
      var items = Array.isArray(group.items) ? group.items : [];
      if (items.length === 0) {
        return;
      }
      var section = document.createElement("section");
      section.className = "artifact-group";
      var title = document.createElement("h3");
      title.textContent = group.title || group.phaseId || "Artifacts";
      section.append(title);
      items.forEach(function (item) {
        rendered += 1;
        section.append(renderArtifactRow(explorer, item));
      });
      elements.artifactList.append(section);
    });
    if (rendered === 0) {
      elements.artifactList.append(artifactEmpty("No artifacts found for this run."));
    }
  }

  function renderArtifactRow(explorer, item) {
    var row = document.createElement("article");
    row.className = "artifact-row" + (state.artifacts.selectedId === item.id ? " selected" : "");
    var details = document.createElement("button");
    details.type = "button";
    details.className = "artifact-row-main";
    details.addEventListener("click", function () {
      previewArtifact(explorer, item);
    });
    var title = document.createElement("strong");
    title.textContent = item.title || item.logicalKey || item.relativePath || item.id;
    var meta = document.createElement("span");
    meta.textContent = [item.kind, item.role, item.relativePath].filter(Boolean).join(" | ");
    details.append(title, meta);

    var actions = document.createElement("div");
    actions.className = "artifact-row-actions";
    var raw = document.createElement("a");
    raw.href = artifactApiUrl(explorer, "/" + encodeURIComponent(item.id) + "/raw");
    raw.target = "_blank";
    raw.rel = "noreferrer";
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
    state.artifacts.selectedId = item.id;
    state.artifacts.preview = { loading: true, content: "Loading preview..." };
    renderArtifactList(explorer);
    renderArtifactPreview();
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
        state.artifacts.preview = {
          loading: false,
          content: preview.content || "",
          truncated: preview.truncated,
          title: preview.artifact && preview.artifact.title ? preview.artifact.title : item.title,
        };
        renderArtifactPreview();
      })
      .catch(function (error) {
        state.artifacts.preview = {
          loading: false,
          content: error.message || "Artifact preview request failed.",
          error: true,
        };
        renderArtifactPreview();
      });
  }

  function renderArtifactPreview() {
    var preview = state.artifacts.preview;
    if (!preview) {
      elements.artifactPreview.textContent = "Select an artifact to preview it.";
      return;
    }
    var prefix = preview.title ? preview.title + "\n\n" : "";
    var suffix = preview.truncated ? "\n\n[Preview truncated]" : "";
    elements.artifactPreview.textContent = prefix + (preview.content || "") + suffix;
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
    return "";
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

  elements.run.addEventListener("click", api.openRunConfirm);
  elements.interrupt.addEventListener("click", api.openInterruptConfirm);
  elements.artifactOpen.addEventListener("click", api.openArtifactExplorer);
  elements.artifactClose.addEventListener("click", api.closeArtifactExplorer);
  elements.help.addEventListener("click", api.toggleHelp);
  elements.closeHelp.addEventListener("click", function () {
    api.showHelp(false);
  });
  elements.clearLog.addEventListener("click", api.clearLog);
  elements.progress.addEventListener("scroll", function () {
    api.scrollPane("progress", Math.round(elements.progress.scrollTop));
  });
  elements.summary.addEventListener("scroll", function () {
    api.scrollPane("summary", Math.round(elements.summary.scrollTop));
  });
  elements.log.addEventListener("scroll", function () {
    api.scrollPane("log", Math.round(elements.log.scrollTop));
  });
  elements.helpText.addEventListener("scroll", function () {
    api.scrollPane("help", Math.round(elements.helpText.scrollTop));
  });

  api.connect();
}());
