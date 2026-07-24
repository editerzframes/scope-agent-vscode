(() => {
  const vscode = acquireVsCodeApi();
  let state = null;
  let renderFrame = 0;
  let historyOpen = false;
  let pendingFixTicket = null;
  const clickUpPayloadApi = globalThis.PuneetClickUp;
  const CLICKUP_TICKETS_PROMPT = [
    "Fetch my incomplete ClickUp Bug and Improvement tickets assigned to the currently authenticated ClickUp user.",
    "Verify and name the active authorized Workspace, keep this read-only, and show the most actionable tickets first.",
  ].join(" ");

  const element = (id) => document.getElementById(id);
  const loading = element("loading");
  const signedOut = element("signed-out");
  const app = element("app");
  const transcript = element("transcript");
  const emptyState = element("empty-state");
  const landingWorkspacePrefix = element("landing-workspace-prefix");
  const landingWorkspace = element("landing-workspace");
  const activities = element("activities");
  const contexts = element("contexts");
  const limits = element("limits");
  const prompt = element("prompt");
  const send = element("send");
  const stop = element("stop");
  const model = element("model");
  const collaborationMode = element("collaboration-mode");
  const modePicker = element("mode-picker");
  const modeIcon = element("mode-icon");
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
      const previousThreadId = state?.threadId;
      const pendingMessages = (state?.messages || []).filter((candidate) => candidate.pending);
      const pendingProgress = pendingMessages.length > 0 && state?.turnProgress?.status === "running"
        ? state.turnProgress
        : null;
      state = message.state;
      if (previousThreadId && previousThreadId !== state.threadId) {
        pendingFixTicket = null;
      }
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
        item = { id: message.id, role: "assistant", text: "", kind: message.kind || "message" };
        state.messages.push(item);
      }
      item.kind = message.kind || item.kind || "message";
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
    landingWorkspacePrefix.textContent = state.workspaceName ? "Ready in " : "";
    landingWorkspace.textContent = state.workspaceName || "Open a local folder";
    landingWorkspace.title = state.workspaceName || "Open a local folder to start";
    emptyState.classList.toggle("no-workspace", !state.workspaceName);
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
    renderCollaborationMode();

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
      prompt.placeholder = state.collaborationMode === "clickup"
        ? "Ask about your ClickUp tickets…"
        : state.collaborationMode === "tad"
          ? "Create a TAD from the current plan and workspace context…"
          : state.collaborationMode === "plan"
            ? "Describe what you want Puneet 3.0 to plan…"
            : "Ask Puneet 3.0 to change your code…";
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
    const pendingQuestions = state.pendingQuestions || [];
    const hasContent = (
      messages.length > 0 ||
      fileChanges.length > 0 ||
      pendingQuestions.length > 0 ||
      Boolean(pendingFixTicket)
    );
    const lastAssistantIndex = messages.reduce(
      (last, message, index) => (message.role === "assistant" ? index : last),
      -1,
    );
    let renderedFileChanges = false;
    emptyState.classList.toggle("hidden", hasContent);
    transcript.classList.toggle("hidden", !hasContent);

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.kind === "clickup") {
        let groupEnd = index + 1;
        while (
          groupEnd < messages.length &&
          messages[groupEnd].role === "assistant" &&
          messages[groupEnd].kind === "clickup"
        ) {
          groupEnd += 1;
        }
        if (
          fileChanges.length > 0 &&
          !renderedFileChanges &&
          lastAssistantIndex >= index &&
          lastAssistantIndex < groupEnd
        ) {
          renderFileChangeCards(transcript, fileChanges);
          renderedFileChanges = true;
        }
        renderClickUpMessageGroup(
          transcript,
          messages.slice(index, groupEnd),
          state.running && groupEnd === messages.length,
        );
        index = groupEnd - 1;
        continue;
      }

      if (fileChanges.length > 0 && !renderedFileChanges && index === lastAssistantIndex) {
        renderFileChangeCards(transcript, fileChanges);
        renderedFileChanges = true;
      }
      renderMessageArticle(transcript, message);
    }

    if (fileChanges.length > 0 && !renderedFileChanges) {
      renderFileChangeCards(transcript, fileChanges);
    }
    renderPendingQuestions(transcript, pendingQuestions);
    renderClickUpFixConfirmation(transcript);

    if (nearBottom || state.running || pendingQuestions.length > 0 || pendingFixTicket) {
      requestAnimationFrame(() => {
        transcript.scrollTop = transcript.scrollHeight;
      });
    }
  }

  function renderMessageArticle(container, message) {
      const article = document.createElement("article");
      const documentKind = message.kind === "plan" || message.kind === "tad";
      article.className = `message ${message.role}${documentKind ? ` ${message.kind}` : ""}${message.pending ? " pending" : ""}`;
      article.dataset.messageId = message.id;

      const role = document.createElement("div");
      role.className = "message-role";
      role.textContent = message.role === "assistant"
        ? message.kind === "tad"
          ? message.documentPath ? "TAD file" : "TAD"
          : message.kind === "plan"
            ? message.documentPath ? "Plan file" : "Plan"
            : "Puneet 3.0"
        : message.role === "user" ? "You" : "Status";

      const body = document.createElement("div");
      body.className = "message-body";
      if (documentKind && message.documentPath) {
        renderDocumentFileCard(body, message);
      } else {
        renderText(body, message.text);
      }
      if (message.pending) {
        const pending = document.createElement("span");
        pending.className = "message-pending";
        pending.textContent = "Sending…";
        body.append(pending);
      }
      article.append(role, body);
      container.append(article);
  }

  function renderClickUpMessageGroup(container, messages, running) {
    const parsed = messages.map((message) => (
      clickUpPayloadApi?.extractClickUpPayload(message.text) || {
        status: "none",
        payload: null,
        displayText: String(message.text || ""),
      }
    ));
    let resultIndex = -1;
    for (let index = parsed.length - 1; index >= 0; index -= 1) {
      if (parsed[index].status === "valid") {
        resultIndex = index;
        break;
      }
    }

    const article = document.createElement("article");
    article.className = "message assistant clickup";
    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = "ClickUp";
    const body = document.createElement("div");
    body.className = "message-body clickup-message-body";

    if (resultIndex >= 0) {
      const progress = parsed
        .filter((_, index) => index !== resultIndex)
        .map((item) => item.displayText)
        .filter(Boolean);
      renderClickUpFetchDetails(body, progress, true);
      if (parsed[resultIndex].displayText) {
        renderText(body, parsed[resultIndex].displayText);
      }
      renderClickUpTickets(body, parsed[resultIndex].payload);
    } else if (running) {
      const progress = parsed.slice(0, -1).map((item) => item.displayText).filter(Boolean);
      renderClickUpFetchDetails(body, progress, false);
      const latest = parsed.at(-1);
      if (latest?.displayText) {
        const update = document.createElement("div");
        update.className = "clickup-live-update";
        renderText(update, latest.displayText);
        body.append(update);
      }
      renderClickUpSkeleton(body);
    } else {
      const progress = parsed.slice(0, -1).map((item) => item.displayText).filter(Boolean);
      renderClickUpFetchDetails(body, progress, true);
      const last = parsed.at(-1);
      renderText(
        body,
        last?.displayText || "ClickUp did not return ticket results. Fetch the tickets again.",
      );
    }
    article.append(role, body);
    container.append(article);
  }

  function renderClickUpFetchDetails(container, updates, completed) {
    if (updates.length === 0) {
      return;
    }
    const details = document.createElement("details");
    details.className = "clickup-fetch-details";
    const summary = document.createElement("summary");
    const icon = document.createElement("span");
    icon.className = "clickup-fetch-icon";
    icon.textContent = completed ? "✓" : "◌";
    const label = document.createElement("span");
    label.textContent = "Fetch details";
    const count = document.createElement("small");
    count.textContent = `${updates.length} update${updates.length === 1 ? "" : "s"}`;
    summary.append(icon, label, count);

    const list = document.createElement("ol");
    for (const update of updates) {
      const item = document.createElement("li");
      renderText(item, update);
      list.append(item);
    }
    details.append(summary, list);
    container.append(details);
  }

  function renderClickUpSkeleton(container) {
    const skeleton = document.createElement("section");
    skeleton.className = "clickup-skeleton";
    skeleton.setAttribute("aria-label", "Loading ClickUp tickets");
    skeleton.setAttribute("role", "status");
    const heading = document.createElement("div");
    heading.className = "clickup-skeleton-heading";
    heading.append(skeletonLine("wide"), skeletonLine("short"));
    const pills = document.createElement("div");
    pills.className = "clickup-skeleton-pills";
    pills.append(skeletonLine("pill"), skeletonLine("pill"), skeletonLine("pill"));
    skeleton.append(heading, pills);
    for (let index = 0; index < 3; index += 1) {
      const card = document.createElement("div");
      card.className = "clickup-skeleton-card";
      card.append(skeletonLine("ticket"), skeletonLine("medium"), skeletonLine("short"));
      skeleton.append(card);
    }
    container.append(skeleton);
  }

  function skeletonLine(kind) {
    const line = document.createElement("span");
    line.className = `skeleton-line ${kind}`;
    return line;
  }

  function renderClickUpTickets(container, payload) {
    if (!payload) {
      return;
    }
    const section = document.createElement("section");
    section.className = "clickup-results";
    section.setAttribute("aria-label", "ClickUp ticket results");

    const workspace = document.createElement("header");
    workspace.className = "clickup-workspace";
    const icon = document.createElement("span");
    icon.className = "clickup-workspace-icon";
    icon.textContent = "CU";
    const copy = document.createElement("span");
    copy.className = "clickup-workspace-copy";
    const title = document.createElement("strong");
    title.textContent = payload.workspace.spaces[0] || payload.workspace.name;
    const context = document.createElement("small");
    context.textContent = [
      payload.workspace.name,
      payload.workspace.id ? `Workspace ${payload.workspace.id}` : "",
    ].filter(Boolean).join(" · ");
    copy.append(title, context);
    workspace.append(icon, copy);

    const pills = document.createElement("div");
    pills.className = "clickup-summary-pills";
    [
      ["total", payload.summary.total, "Total"],
      ["bug", payload.summary.bugs, "Bugs"],
      ["improvement", payload.summary.improvements, "Improvements"],
      ["blocked", payload.summary.blocked, "Blocked"],
      ["overdue", payload.summary.overdue, "Overdue"],
    ].forEach(([kind, value, label]) => {
      const pill = document.createElement("span");
      pill.className = `clickup-summary-pill ${kind}`;
      const count = document.createElement("strong");
      count.textContent = String(value);
      pill.append(count, document.createTextNode(` ${label}`));
      pills.append(pill);
    });

    const ticketList = document.createElement("div");
    ticketList.className = "clickup-ticket-list";
    if (payload.tickets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "clickup-empty";
      empty.textContent = "No incomplete Bug or Improvement tickets were found.";
      ticketList.append(empty);
    } else {
      for (const ticket of payload.tickets) {
        ticketList.append(createClickUpTicketCard(ticket));
      }
    }
    section.append(workspace, pills, ticketList);

    if (payload.notes.length > 0) {
      const notes = document.createElement("div");
      notes.className = "clickup-notes";
      const notesLabel = document.createElement("strong");
      notesLabel.textContent = "Notes";
      const notesList = document.createElement("ul");
      for (const note of payload.notes) {
        const item = document.createElement("li");
        item.textContent = note;
        notesList.append(item);
      }
      notes.append(notesLabel, notesList);
      section.append(notes);
    }
    container.append(section);
  }

  function createClickUpTicketCard(ticket) {
    const card = document.createElement("details");
    card.className = `clickup-ticket-card ${ticket.category.toLowerCase()}`;

    const summary = document.createElement("summary");
    const rank = document.createElement("span");
    rank.className = "clickup-rank";
    rank.textContent = String(ticket.rank);

    const primary = document.createElement("span");
    primary.className = "clickup-ticket-primary";
    const ticketMeta = document.createElement("span");
    ticketMeta.className = "clickup-ticket-meta";
    const id = document.createElement("strong");
    id.textContent = ticket.id;
    const category = document.createElement("span");
    category.className = `clickup-category ${ticket.category.toLowerCase()}`;
    category.textContent = ticket.category;
    ticketMeta.append(id, category);
    const title = document.createElement("span");
    title.className = "clickup-ticket-title";
    title.textContent = ticket.title;
    primary.append(ticketMeta, title);

    const trailing = document.createElement("span");
    trailing.className = "clickup-ticket-trailing";
    const status = document.createElement("span");
    status.className = "clickup-status";
    status.textContent = ticket.status;
    const due = document.createElement("span");
    due.className = `clickup-due${ticket.overdue ? " overdue" : ""}`;
    due.textContent = formatClickUpDueDate(ticket.dueDate, ticket.overdue);
    trailing.append(status, due);
    summary.append(rank, primary, trailing);

    const detail = document.createElement("div");
    detail.className = "clickup-ticket-detail";
    const metadata = document.createElement("dl");
    metadata.className = "clickup-ticket-fields";
    appendTicketField(metadata, "Assignees", ticket.assignees.join(", ") || "Unassigned");
    appendTicketField(metadata, "List", ticket.list || "Not provided");
    appendTicketField(metadata, "Priority", ticket.priority || "Not set");
    if (ticket.blocked) {
      appendTicketField(metadata, "Blocked", "Yes");
    }
    detail.append(metadata);

    if (ticket.whyActionable) {
      const reason = document.createElement("div");
      reason.className = "clickup-actionability";
      const label = document.createElement("strong");
      label.textContent = "Why actionable";
      const text = document.createElement("p");
      text.textContent = ticket.whyActionable;
      reason.append(label, text);
      detail.append(reason);
    }

    const actions = document.createElement("div");
    actions.className = "clickup-ticket-actions";
    const summarize = document.createElement("button");
    summarize.type = "button";
    summarize.className = "clickup-card-action";
    summarize.textContent = "Summarize";
    summarize.disabled = state.running;
    summarize.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const actionTicket = clickUpActionTicket(ticket);
      beginPrompt(
        buildClickUpSummaryPrompt(actionTicket),
        "summarizeClickUpTicket",
        { ticket: actionTicket },
      );
    });

    const fix = document.createElement("button");
    fix.type = "button";
    fix.className = "clickup-card-action fix";
    fix.textContent = "Fix this";
    fix.disabled = state.running;
    fix.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pendingFixTicket = clickUpActionTicket(ticket);
      scheduleRender();
    });
    actions.append(summarize, fix);

    if (ticket.url) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "clickup-open";
      open.textContent = "Open in ClickUp ↗";
      open.disabled = state.running;
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        post("openClickUpTicket", { url: ticket.url });
      });
      actions.append(open);
    }
    detail.append(actions);
    card.append(summary, detail);
    return card;
  }

  function clickUpActionTicket(ticket) {
    return {
      id: ticket.id,
      title: ticket.title,
      category: ticket.category,
      status: ticket.status,
      url: ticket.url,
      whyActionable: ticket.whyActionable,
    };
  }

  function buildClickUpSummaryPrompt(ticket) {
    return [
      `Summarize ClickUp ${ticket.category.toLowerCase()} ${ticket.id}: ${ticket.title}.`,
      "Use the ticket context already available in this chat and retrieve read-only details only when needed.",
      "Cover the problem, expected behavior, impact, reproduction evidence, important unknowns, and the recommended next step.",
      "Do not change ClickUp or workspace files.",
    ].join(" ");
  }

  function buildClickUpFixPrompt(ticket) {
    return [
      `Fix ClickUp ${ticket.category.toLowerCase()} ${ticket.id}: ${ticket.title}.`,
      "Use the ticket context already available in this chat.",
      "Inspect the repository, confirm the root cause, implement the safest focused code change, and run the relevant verification.",
      "Do not modify the ClickUp ticket.",
      "If the available ticket context is insufficient or a meaningful product decision is required, ask me in chat before changing code.",
    ].join(" ");
  }

  function renderClickUpFixConfirmation(container) {
    if (!pendingFixTicket) {
      return;
    }
    const ticket = pendingFixTicket;
    const article = document.createElement("article");
    article.className = "message assistant question-message";
    const role = document.createElement("div");
    role.className = "message-role";
    role.textContent = "Confirm fix";
    const card = document.createElement("section");
    card.className = "chat-question-card fix-confirmation";
    const eyebrow = document.createElement("span");
    eyebrow.className = "question-eyebrow";
    eyebrow.textContent = `${ticket.category} · ${ticket.id}`;
    const title = document.createElement("strong");
    title.className = "question-title";
    title.textContent = `Start fixing “${ticket.title}”?`;
    const description = document.createElement("p");
    description.textContent = "Puneet 3.0 will switch to Agent mode, inspect the repository, make the focused code change, and run relevant checks. ClickUp will remain read-only.";
    const promptPreview = document.createElement("details");
    promptPreview.className = "fix-prompt-preview";
    const previewSummary = document.createElement("summary");
    previewSummary.textContent = "Review prompt";
    const previewText = document.createElement("p");
    previewText.textContent = buildClickUpFixPrompt(ticket);
    promptPreview.append(previewSummary, previewText);

    const choices = document.createElement("div");
    choices.className = "question-choices confirmation-choices";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "question-option primary";
    go.textContent = "Go";
    go.addEventListener("click", () => {
      const confirmedTicket = pendingFixTicket;
      pendingFixTicket = null;
      state.collaborationMode = "agent";
      renderCollaborationMode();
      beginPrompt(
        buildClickUpFixPrompt(confirmedTicket),
        "fixClickUpTicket",
        { ticket: confirmedTicket },
      );
    });
    const no = document.createElement("button");
    no.type = "button";
    no.className = "question-option";
    no.textContent = "No";
    no.addEventListener("click", () => {
      pendingFixTicket = null;
      scheduleRender();
    });
    choices.append(go, no);
    card.append(eyebrow, title, description, promptPreview, choices);
    article.append(role, card);
    container.append(article);
  }

  function renderPendingQuestions(container, questions) {
    questions.forEach((question, index) => {
      const article = document.createElement("article");
      article.className = "message assistant question-message";
      const role = document.createElement("div");
      role.className = "message-role";
      role.textContent = "Input needed";
      const card = document.createElement("section");
      card.className = "chat-question-card";
      card.dataset.questionId = question.id;
      const eyebrow = document.createElement("span");
      eyebrow.className = "question-eyebrow";
      eyebrow.textContent = question.header || "Puneet 3.0 needs input";
      const title = document.createElement("strong");
      title.className = "question-title";
      title.textContent = question.question;
      card.append(eyebrow, title);

      if (question.options?.length) {
        const choices = document.createElement("div");
        choices.className = "question-choices";
        for (const option of question.options) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "question-option";
          const label = document.createElement("strong");
          label.textContent = option.label;
          button.append(label);
          if (option.description) {
            const description = document.createElement("span");
            description.textContent = option.description;
            button.append(description);
          }
          button.addEventListener("click", () => {
            disableQuestionCard(card);
            post("answerQuestion", {
              questionId: question.id,
              answer: option.label,
              custom: false,
            });
          });
          choices.append(button);
        }
        card.append(choices);
      }

      if (question.allowsOther) {
        const form = document.createElement("form");
        form.className = "question-custom-answer";
        const input = document.createElement("input");
        input.type = question.isSecret ? "password" : "text";
        input.placeholder = question.options?.length ? "Other answer…" : "Type your answer…";
        input.setAttribute("aria-label", `Answer ${question.header || `question ${index + 1}`}`);
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.textContent = "Send";
        submit.disabled = true;
        input.addEventListener("input", () => {
          submit.disabled = !input.value.trim();
        });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const answer = input.value.trim();
          if (!answer) {
            return;
          }
          disableQuestionCard(card);
          post("answerQuestion", {
            questionId: question.id,
            answer,
            custom: true,
          });
        });
        form.append(input, submit);
        card.append(form);
      }

      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "question-skip";
      skip.textContent = "Skip";
      skip.addEventListener("click", () => {
        disableQuestionCard(card);
        post("answerQuestion", {
          questionId: question.id,
          answer: "",
          custom: true,
        });
      });
      card.append(skip);
      article.append(role, card);
      container.append(article);
    });
  }

  function disableQuestionCard(card) {
    card.classList.add("answering");
    card.querySelectorAll("button, input").forEach((control) => {
      control.disabled = true;
    });
  }

  function appendTicketField(container, label, value) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    group.append(term, description);
    container.append(group);
  }

  function formatClickUpDueDate(value, overdue) {
    if (!value) {
      return "No due date";
    }
    const normalized = /^\d+$/.test(value) ? Number(value) : value;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return `${overdue ? "Overdue · " : ""}${value}`;
    }
    const label = parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return overdue ? `Overdue · ${label}` : label;
  }

  function renderDocumentFileCard(container, message) {
    const isTad = message.kind === "tad";
    const button = document.createElement("button");
    button.className = `plan-file-card${isTad ? " tad" : ""}`;
    button.title = `Open ${message.documentLabel || message.documentPath}`;
    button.addEventListener("click", () => post("openDocumentFile", { path: message.documentPath }));

    const icon = document.createElement("span");
    icon.className = "plan-file-icon";
    icon.textContent = isTad ? "TAD" : "MD";

    const copy = document.createElement("span");
    copy.className = "plan-file-copy";
    const title = document.createElement("strong");
    title.textContent = message.text || (isTad ? "Technical architecture document" : "Implementation plan");
    const path = document.createElement("small");
    path.textContent = message.documentLabel || message.documentPath;
    copy.append(title, path);

    const open = document.createElement("span");
    open.className = "plan-file-open";
    open.textContent = "↗";
    button.append(icon, copy, open);
    container.append(button);
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
    const value = String(text || "");
    const fence = /```([^\r\n`]*)\r?\n?([\s\S]*?)```/g;
    let cursor = 0;
    let match;
    while ((match = fence.exec(value)) !== null) {
      renderMarkdownBlocks(container, value.slice(cursor, match.index));
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (match[1].trim()) {
        code.dataset.language = match[1].trim();
      }
      code.textContent = match[2];
      pre.append(code);
      container.append(pre);
      cursor = match.index + match[0].length;
    }
    renderMarkdownBlocks(container, value.slice(cursor));
  }

  function renderMarkdownBlocks(container, text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index += 1;
        continue;
      }

      const heading = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
      if (heading) {
        const node = document.createElement(heading[1].length === 1 ? "h3" : "h4");
        appendInlineMarkdown(node, heading[2]);
        container.append(node);
        index += 1;
        continue;
      }

      const listMatch = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[index]);
      if (listMatch) {
        const ordered = Boolean(listMatch[2]);
        const list = document.createElement(ordered ? "ol" : "ul");
        while (index < lines.length) {
          const itemMatch = /^\s*(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[index]);
          if (!itemMatch || Boolean(itemMatch[2]) !== ordered) {
            break;
          }
          const item = document.createElement("li");
          appendInlineMarkdown(item, itemMatch[3]);
          list.append(item);
          index += 1;
        }
        container.append(list);
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(#{1,3})\s+/.test(lines[index]) &&
        !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])
      ) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }
      const paragraph = document.createElement("p");
      paragraph.className = "prose";
      paragraphLines.forEach((line, lineIndex) => {
        if (lineIndex > 0) {
          paragraph.append(document.createElement("br"));
        }
        appendInlineMarkdown(paragraph, line);
      });
      container.append(paragraph);
    }
  }

  function appendInlineMarkdown(container, text) {
    const pattern = /(\*\*([^*]+)\*\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      container.append(document.createTextNode(text.slice(cursor, match.index)));
      if (match[2] !== undefined) {
        const strong = document.createElement("strong");
        strong.textContent = match[2];
        container.append(strong);
      } else if (match[3] !== undefined) {
        const code = document.createElement("code");
        code.className = "inline-code";
        code.textContent = match[3];
        container.append(code);
      } else if (match[4] !== undefined && isSafeExternalLink(match[5])) {
        const url = match[5];
        const link = document.createElement("a");
        link.className = "markdown-link";
        link.href = url;
        link.textContent = match[4];
        link.addEventListener("click", (event) => {
          event.preventDefault();
          post("openExternalLink", { url });
        });
        container.append(link);
      } else {
        container.append(document.createTextNode(match[0]));
      }
      cursor = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }

  function isSafeExternalLink(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
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

    runStatusLabel.textContent = progress.label || (running ? "Puneet 3.0 is working" : "Task finished");
    runStatusDetail.textContent = progress.detail || (running ? "The task is still running." : "Puneet 3.0 finished the task.");
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
        runStatusHeartbeat.textContent = "Live · waiting for the next Puneet 3.0 event";
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

  function renderCollaborationMode() {
    const selected = ["agent", "plan", "tad", "clickup"].includes(state.collaborationMode)
      ? state.collaborationMode
      : "agent";
    collaborationMode.value = selected;
    collaborationMode.disabled = state.turnProgress?.status === "running";
    modePicker.classList.toggle("plan", selected === "plan");
    modePicker.classList.toggle("tad", selected === "tad");
    modePicker.classList.toggle("clickup", selected === "clickup");
    modeIcon.textContent = selected === "clickup"
      ? "◫"
      : selected === "tad"
        ? "▤"
        : selected === "plan"
          ? "◇"
          : "◆";
    modePicker.title = selected === "clickup"
      ? "ClickUp mode: fetch your assigned tickets without changing them"
      : selected === "tad"
        ? "TAD mode: create a technical architecture document from this chat and workspace"
        : selected === "plan"
          ? "Plan mode: inspect and propose a plan without making code changes"
          : "Agent mode: inspect, run commands, and make code changes";
  }

  function submit() {
    const value = prompt.value.trim();
    if (!value || !state?.workspaceName) {
      return;
    }
    prompt.value = "";
    resizePrompt();
    beginPrompt(value, "sendPrompt");
  }

  function beginPrompt(value, messageType, extras = {}) {
    const now = Date.now();
    const startingNewTurn = state.turnProgress?.status !== "running";
    state.running = true;
    if (startingNewTurn) {
      state.fileChanges = [];
    }
    state.turnProgress = {
      status: "running",
      label: "Sending your request",
      detail: state.collaborationMode === "clickup"
        ? "Connecting to ClickUp and fetching your assigned tickets."
        : state.collaborationMode === "tad"
          ? "Starting a TAD turn with the current plan and workspace context."
          : state.collaborationMode === "plan"
            ? "Starting a planning turn in this workspace."
            : "Starting a Puneet 3.0 task in this workspace.",
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
    post(messageType, { prompt: value, ...extras });
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
  element("plans").addEventListener("click", () => post("openPlans"));
  element("tads").addEventListener("click", () => post("openTads"));
  element("settings").addEventListener("click", () => post("openSettings"));
  stop.addEventListener("click", () => post("stop"));
  send.addEventListener("click", submit);
  model.addEventListener("change", () => post("setModel", { model: model.value }));
  collaborationMode.addEventListener("change", () => {
    state.collaborationMode = ["agent", "plan", "tad", "clickup"].includes(collaborationMode.value)
      ? collaborationMode.value
      : "agent";
    renderCollaborationMode();
    if (state.collaborationMode === "clickup") {
      beginPrompt(CLICKUP_TICKETS_PROMPT, "activateClickUp");
    } else {
      post("setCollaborationMode", { mode: state.collaborationMode });
    }
    prompt.focus();
  });
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
