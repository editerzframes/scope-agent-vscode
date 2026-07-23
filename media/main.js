(() => {
  const vscode = acquireVsCodeApi();
  let state = null;
  let renderFrame = 0;
  let historyOpen = false;

  const element = (id) => document.getElementById(id);
  const loading = element("loading");
  const signedOut = element("signed-out");
  const app = element("app");
  const transcript = element("transcript");
  const emptyState = element("empty-state");
  const activities = element("activities");
  const contexts = element("contexts");
  const limits = element("limits");
  const prompt = element("prompt");
  const send = element("send");
  const stop = element("stop");
  const model = element("model");
  const errorBanner = element("error-banner");
  const workspaceBanner = element("workspace-banner");
  const runStatus = element("run-status");
  const runStatusIcon = element("run-status-icon");
  const runStatusLabel = element("run-status-label");
  const runStatusDetail = element("run-status-detail");
  const runStatusTime = element("run-status-time");
  const runStatusHeartbeat = element("run-status-heartbeat");
  const topRunLabel = element("top-run-label");
  const historyPanel = element("history-panel");
  const historyList = element("history-list");

  const post = (type, extras = {}) => vscode.postMessage({ type, ...extras });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.type === "state") {
      const pendingMessages = (state?.messages || []).filter((candidate) => candidate.pending);
      const pendingProgress = pendingMessages.length > 0 && state?.turnProgress?.status === "running"
        ? state.turnProgress
        : null;
      state = message.state;
      for (const pending of pendingMessages) {
        const confirmed = (state.messages || []).some(
          (candidate) => candidate.role === "user" && !candidate.pending && candidate.text === pending.text,
        );
        if (!confirmed) {
          state.messages.push(pending);
        }
      }
      if (pendingProgress && state.turnProgress?.status === "idle") {
        state.turnProgress = pendingProgress;
        state.running = true;
      }
      scheduleRender();
    } else if (message?.type === "openHistory") {
      historyOpen = true;
      renderHistory();
    } else if (message?.type === "delta" && state) {
      let item = state.messages.find((candidate) => candidate.id === message.id);
      if (!item) {
        item = { id: message.id, role: "assistant", text: "" };
        state.messages.push(item);
      }
      item.text += message.delta;
      scheduleRender();
    } else if (message?.type === "progress" && state) {
      state.turnProgress = message.progress;
      state.running = message.progress?.status === "running";
      renderProgress();
    } else if (message?.type === "actionError") {
      if (state) {
        state.messages = (state.messages || []).filter((candidate) => !candidate.pending);
        state.running = false;
        state.turnProgress = {
          ...(state.turnProgress || {}),
          status: "failed",
          label: "Task could not start",
          detail: message.message,
          completedAtMs: Date.now(),
          lastProgressAtMs: Date.now(),
        };
      }
      errorBanner.textContent = message.message;
      errorBanner.classList.remove("hidden");
      scheduleRender();
    }
  });

  function scheduleRender() {
    if (renderFrame) {
      return;
    }
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      render();
    });
  }

  function render() {
    if (!state) {
      return;
    }

    const waiting = state.connection === "idle" || state.connection === "starting";
    const needsSignIn = state.requiresOpenaiAuth && !state.account && !waiting;
    loading.classList.toggle("hidden", !waiting);
    signedOut.classList.toggle("hidden", !needsSignIn);
    app.classList.toggle("hidden", waiting || needsSignIn);
    if (waiting || needsSignIn) {
      return;
    }

    const isRunning = state.turnProgress?.status === "running";
    element("connection-dot").className = `connection-dot ${isRunning ? "working" : state.connection}`;
    element("account-label").textContent = state.account
      ? `${state.account.label}${state.account.plan ? ` · ${humanize(state.account.plan)}` : ""}`
      : "Codex runtime";
    element("workspace-name").textContent = state.workspaceName || "No workspace";
    workspaceBanner.classList.toggle("hidden", Boolean(state.workspaceName));

    errorBanner.textContent = state.error || "";
    errorBanner.classList.toggle("hidden", !state.error);

    renderLimits();
    renderHistory();
    renderMessages();
    renderActivities();
    renderProgress();
    renderContexts();
    renderModels();

    stop.classList.toggle("hidden", !isRunning);
    send.textContent = isRunning ? "↳" : "↑";
    send.title = isRunning ? "Steer current turn" : "Send";
    send.disabled = !state.workspaceName || !prompt.value.trim();
    if (isRunning) {
      prompt.placeholder = "Send a follow-up to the running turn…";
    } else if (state.turnProgress?.status === "completed") {
      prompt.placeholder = "Task finished — ask a follow-up…";
    } else if (["failed", "interrupted"].includes(state.turnProgress?.status)) {
      prompt.placeholder = "Task stopped — revise or try again…";
    } else {
      prompt.placeholder = "Ask SCOPE to change your code…";
    }
  }

  function renderHistory() {
    if (!historyPanel || !historyList || !state) {
      return;
    }
    historyPanel.classList.toggle("hidden", !historyOpen);
    historyList.replaceChildren();

    const threads = state.threads || [];
    if (threads.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "No previous chats in this workspace yet.";
      historyList.append(empty);
      return;
    }

    for (const thread of threads) {
      const button = document.createElement("button");
      button.className = `history-item${thread.active ? " active" : ""}`;
      button.title = thread.preview || thread.title;

      const title = document.createElement("strong");
      title.textContent = thread.title || "Untitled chat";
      const meta = document.createElement("span");
      meta.textContent = `${thread.running ? "Working · " : ""}${formatRelativeTime(thread.updatedAt)}`;
      button.append(title, meta);
      button.addEventListener("click", () => {
        historyOpen = false;
        renderHistory();
        post("openThread", { threadId: thread.id });
      });
      historyList.append(button);
    }
  }

  function renderLimits() {
    limits.replaceChildren();
    const visible = (state.limits || []).slice(0, 4);
    limits.classList.toggle("hidden", visible.length === 0);
    for (const limit of visible) {
      const card = document.createElement("div");
      card.className = "limit-card";

      const row = document.createElement("div");
      row.className = "limit-row";
      const label = document.createElement("span");
      label.textContent = `${limit.label} · ${limit.window}`;
      const value = document.createElement("span");
      value.textContent = `${Math.round(limit.usedPercent)}%`;
      row.append(label, value);

      const track = document.createElement("div");
      track.className = "limit-track";
      const fill = document.createElement("div");
      fill.className = "limit-fill";
      fill.style.width = `${limit.usedPercent}%`;
      track.append(fill);
      card.append(row, track);

      if (limit.resetsAt) {
        const reset = document.createElement("div");
        reset.className = "limit-reset";
        reset.textContent = `Resets ${formatReset(limit.resetsAt)}`;
        card.append(reset);
      }
      limits.append(card);
    }
  }

  function renderMessages() {
    const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
    transcript.replaceChildren();
    const messages = state.messages || [];
    const fileChanges = state.fileChanges || [];
    const hasContent = messages.length > 0 || fileChanges.length > 0;
    const lastAssistantIndex = messages.reduce(
      (last, message, index) => (message.role === "assistant" ? index : last),
      -1,
    );
    let renderedFileChanges = false;
    emptyState.classList.toggle("hidden", hasContent);
    transcript.classList.toggle("hidden", !hasContent);

    messages.forEach((message, index) => {
      if (fileChanges.length > 0 && index === lastAssistantIndex) {
        renderFileChangeCards(transcript, fileChanges);
        renderedFileChanges = true;
      }
      const article = document.createElement("article");
      article.className = `message ${message.role}${message.pending ? " pending" : ""}`;
      article.dataset.messageId = message.id;

      const role = document.createElement("div");
      role.className = "message-role";
      role.textContent = message.role === "assistant" ? "SCOPE" : message.role === "user" ? "You" : "Status";

      const body = document.createElement("div");
      body.className = "message-body";
      renderText(body, message.text);
      if (message.pending) {
        const pending = document.createElement("span");
        pending.className = "message-pending";
        pending.textContent = "Sending…";
        body.append(pending);
      }
      article.append(role, body);
      transcript.append(article);
    });

    if (fileChanges.length > 0 && !renderedFileChanges) {
      renderFileChangeCards(transcript, fileChanges);
    }

    if (nearBottom || state.running) {
      requestAnimationFrame(() => {
        transcript.scrollTop = transcript.scrollHeight;
      });
    }
  }

  function renderFileChangeCards(container, changes) {
    const section = document.createElement("section");
    section.className = "chat-file-changes";
    section.setAttribute("aria-label", "Files changed by Codex");

    for (const change of changes) {
      const card = document.createElement("article");
      card.className = `file-change-card ${change.kind} ${change.status}`;

      const header = document.createElement("button");
      header.className = "file-change-header";
      header.title = `Open ${change.label}`;
      header.addEventListener("click", () => post("openChangedFile", {
        path: change.path,
        kind: change.kind,
      }));

      const icon = document.createElement("span");
      icon.className = "file-change-icon";
      icon.textContent = change.status === "running" ? "◌" : change.kind === "delete" ? "−" : "◆";

      const nameGroup = document.createElement("span");
      nameGroup.className = "file-change-name-group";
      const parts = String(change.label || change.path).split(/[\\/]/);
      const name = document.createElement("strong");
      name.textContent = parts.pop() || "Changed file";
      const directory = document.createElement("small");
      directory.textContent = parts.join("/");
      nameGroup.append(name);
      if (directory.textContent) {
        nameGroup.append(directory);
      }

      const counts = document.createElement("span");
      counts.className = "file-change-counts";
      if (change.added > 0) {
        const added = document.createElement("span");
        added.className = "added-count";
        added.textContent = `+${change.added}`;
        counts.append(added);
      }
      if (change.deleted > 0) {
        const deleted = document.createElement("span");
        deleted.className = "deleted-count";
        deleted.textContent = `−${change.deleted}`;
        counts.append(deleted);
      }
      if (change.status === "running") {
        const applying = document.createElement("span");
        applying.className = "applying-label";
        applying.textContent = "Applying…";
        counts.append(applying);
      }

      const open = document.createElement("span");
      open.className = "file-change-open";
      open.textContent = "↗";
      header.append(icon, nameGroup, counts, open);
      card.append(header);

      const preview = document.createElement("div");
      preview.className = "file-change-preview";
      const lines = diffPreviewLines(change.diff);
      if (lines.length === 0) {
        const unavailable = document.createElement("div");
        unavailable.className = "diff-unavailable";
        unavailable.textContent = change.kind === "delete" ? "File deleted" : "Open the file to review this change";
        preview.append(unavailable);
      } else {
        lines.slice(0, 12).forEach((line) => {
          const row = document.createElement("div");
          row.className = `diff-line ${line.kind}`;
          const marker = document.createElement("span");
          marker.className = "diff-marker";
          marker.textContent = line.kind === "added" ? "+" : line.kind === "deleted" ? "−" : " ";
          const code = document.createElement("code");
          code.textContent = line.text || " ";
          row.append(marker, code);
          preview.append(row);
        });
        if (lines.length > 12) {
          const more = document.createElement("div");
          more.className = "diff-more";
          more.textContent = `Open file to see ${lines.length - 12} more line${lines.length - 12 === 1 ? "" : "s"}`;
          preview.append(more);
        }
      }
      card.append(preview);
      section.append(card);
    }
    container.append(section);
  }

  function diffPreviewLines(diff) {
    const result = [];
    let insideHunk = false;
    for (const line of String(diff || "").split(/\r?\n/)) {
      if (line.startsWith("@@")) {
        insideHunk = true;
        continue;
      }
      if (!insideHunk || !line || line.startsWith("\\ No newline")) {
        continue;
      }
      if (line.startsWith("+")) {
        result.push({ kind: "added", text: line.slice(1) });
      } else if (line.startsWith("-")) {
        result.push({ kind: "deleted", text: line.slice(1) });
      } else if (line.startsWith(" ")) {
        result.push({ kind: "context", text: line.slice(1) });
      }
    }
    return result;
  }

  function renderText(container, text) {
    const parts = String(text || "").split("```");
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = part.replace(/^\w+\n/, "");
        pre.append(code);
        container.append(pre);
      } else if (part) {
        const block = document.createElement("div");
        block.className = "prose";
        block.textContent = part;
        container.append(block);
      }
    });
  }

  function renderActivities() {
    activities.replaceChildren();
    const visible = (state.activities || []).slice(-6);
    activities.classList.toggle("hidden", visible.length === 0);
    for (const activity of visible) {
      const row = document.createElement("details");
      row.className = `activity ${activity.status}`;
      const summary = document.createElement("summary");
      const icon = document.createElement("span");
      icon.className = "activity-icon";
      icon.textContent = activity.status === "running" ? "◌" : activity.status === "failed" ? "×" : "✓";
      const label = document.createElement("span");
      label.textContent = activity.label;
      summary.append(icon, label);
      const detail = document.createElement("pre");
      detail.textContent = activity.detail;
      row.append(summary, detail);
      activities.append(row);
    }
  }

  function renderProgress() {
    if (!state) {
      return;
    }
    const progress = state.turnProgress || { status: "idle" };
    const visible = progress.status !== "idle";
    const running = progress.status === "running";
    runStatus.className = `run-status ${progress.status}${visible ? "" : " hidden"}`;
    topRunLabel.className = `top-run-label ${progress.status}${visible ? "" : " hidden"}`;
    topRunLabel.textContent = running
      ? "Working"
      : progress.status === "completed"
        ? "Finished"
        : progress.status === "interrupted"
          ? "Stopped"
          : progress.status === "failed"
            ? "Failed"
            : "";

    if (!visible) {
      return;
    }

    runStatusLabel.textContent = progress.label || (running ? "SCOPE is working" : "Task finished");
    runStatusDetail.textContent = progress.detail || (running ? "The task is still running." : "SCOPE finished the task.");
    runStatusIcon.textContent = running
      ? ""
      : progress.status === "completed"
        ? "✓"
        : progress.status === "interrupted"
          ? "■"
          : "×";

    const end = running ? Date.now() : progress.completedAtMs || Date.now();
    const elapsed = progress.durationMs ?? (progress.startedAtMs ? Math.max(0, end - progress.startedAtMs) : 0);
    runStatusTime.textContent = formatDuration(elapsed);

    if (running) {
      const silentMs = progress.lastProgressAtMs ? Math.max(0, Date.now() - progress.lastProgressAtMs) : 0;
      if (silentMs >= 15_000) {
        runStatusHeartbeat.textContent = `Still working · no new event for ${formatDuration(silentMs)}`;
      } else {
        runStatusHeartbeat.textContent = "Live · waiting for the next SCOPE event";
      }
    } else {
      runStatusHeartbeat.textContent = progress.status === "completed"
        ? "Ready for your next request"
        : "You can revise the prompt and try again";
    }
  }

  function renderContexts() {
    contexts.replaceChildren();
    const entries = state.contexts || [];
    contexts.classList.toggle("hidden", entries.length === 0);
    for (const context of entries) {
      const chip = document.createElement("button");
      chip.className = "context-chip";
      chip.title = `${context.path}\nClick to remove`;
      chip.textContent = `${context.kind === "file" ? "▤" : "⌁"} ${context.label} ×`;
      chip.addEventListener("click", () => post("removeContext", { id: context.id }));
      contexts.append(chip);
    }
  }

  function renderModels() {
    const current = model.value;
    model.replaceChildren();
    for (const item of state.models || []) {
      const option = document.createElement("option");
      option.value = item.model;
      option.textContent = item.label;
      option.title = item.description;
      model.append(option);
    }
    const target = state.selectedModel || current;
    if (target) {
      model.value = target;
    }
    model.disabled = !state.models?.length;
  }

  function submit() {
    const value = prompt.value.trim();
    if (!value || !state?.workspaceName) {
      return;
    }
    prompt.value = "";
    resizePrompt();
    const now = Date.now();
    const startingNewTurn = state.turnProgress?.status !== "running";
    state.running = true;
    if (startingNewTurn) {
      state.fileChanges = [];
    }
    state.turnProgress = {
      status: "running",
      label: "Sending your request",
      detail: "Starting a SCOPE task in this workspace.",
      startedAtMs: now,
      lastProgressAtMs: now,
      completedAtMs: null,
      durationMs: null,
    };
    if (!value.startsWith("/")) {
      state.messages = state.messages || [];
      state.messages.push({
        id: `pending-${now}-${Math.random().toString(36).slice(2)}`,
        role: "user",
        text: value,
        pending: true,
      });
    }
    renderProgress();
    scheduleRender();
    post("sendPrompt", { prompt: value });
  }

  function resizePrompt() {
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(180, Math.max(24, prompt.scrollHeight))}px`;
    if (state) {
      send.disabled = !state.workspaceName || !prompt.value.trim();
    }
  }

  function humanize(value) {
    return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatReset(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    const delta = date.getTime() - Date.now();
    if (delta > 0 && delta < 36e5) {
      return `in ${Math.max(1, Math.round(delta / 6e4))} min`;
    }
    if (delta > 0 && delta < 1728e5) {
      return `in ${Math.max(1, Math.round(delta / 36e5))} hr`;
    }
    return date.toLocaleString();
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatRelativeTime(unixSeconds) {
    if (!unixSeconds) {
      return "Earlier";
    }
    const delta = Math.max(0, Date.now() - unixSeconds * 1000);
    if (delta < 60_000) {
      return "Just now";
    }
    if (delta < 3_600_000) {
      return `${Math.floor(delta / 60_000)} min ago`;
    }
    if (delta < 86_400_000) {
      return `${Math.floor(delta / 3_600_000)} hr ago`;
    }
    if (delta < 604_800_000) {
      return `${Math.floor(delta / 86_400_000)} days ago`;
    }
    return new Date(unixSeconds * 1000).toLocaleDateString();
  }

  element("login-chatgpt").addEventListener("click", () => post("loginChatGPT"));
  element("login-api-key").addEventListener("click", () => post("loginApiKey"));
  element("account-button").addEventListener("click", () => post("refresh"));
  element("history-button").addEventListener("click", () => {
    historyOpen = !historyOpen;
    renderHistory();
    if (historyOpen) {
      post("refreshThreads");
    }
  });
  element("history-close").addEventListener("click", () => {
    historyOpen = false;
    renderHistory();
  });
  element("history-new-chat").addEventListener("click", () => {
    historyOpen = false;
    renderHistory();
    post("newThread");
  });
  element("new-chat").addEventListener("click", () => {
    historyOpen = false;
    renderHistory();
    post("newThread");
  });
  element("command-menu").addEventListener("click", () => post("openCommandMenu"));
  element("add-file").addEventListener("click", () => post("addActiveFile"));
  element("add-selection").addEventListener("click", () => post("addSelection"));
  element("settings").addEventListener("click", () => post("openSettings"));
  stop.addEventListener("click", () => post("stop"));
  send.addEventListener("click", submit);
  model.addEventListener("change", () => post("setModel", { model: model.value }));
  prompt.addEventListener("input", resizePrompt);
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      prompt.value = button.dataset.prompt || "";
      resizePrompt();
      prompt.focus();
    });
  });
  document.querySelector('[data-command="review"]').addEventListener("click", () => {
    prompt.value = "/review";
    submit();
  });

  setInterval(() => {
    if (state?.turnProgress?.status === "running") {
      renderProgress();
    }
  }, 1000);

  post("ready");
})();
