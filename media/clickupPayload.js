(function initializeClickUpPayload(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PuneetClickUp = api;
  }
})(typeof globalThis === "object" ? globalThis : this, function createClickUpPayloadApi() {
  const COMPLETE_FENCE = /```clickup-tickets[ \t]*\r?\n([\s\S]*?)```/i;
  const OPEN_FENCE = /```clickup-tickets(?:[ \t]*\r?\n)?/i;

  function extractClickUpPayload(value) {
    const text = String(value || "");
    const complete = COMPLETE_FENCE.exec(text);
    if (!complete) {
      if (OPEN_FENCE.test(text)) {
        return {
          status: "incomplete",
          payload: null,
          displayText: text.slice(0, text.search(OPEN_FENCE)).trim(),
        };
      }
      const legacyPayload = extractLegacyMarkdownPayload(text);
      if (legacyPayload) {
        return {
          status: "valid",
          payload: normalizePayload(legacyPayload),
          displayText: "",
        };
      }
      return { status: "none", payload: null, displayText: text.trim() };
    }

    const before = text.slice(0, complete.index).trim();
    const after = text.slice(complete.index + complete[0].length).trim();
    try {
      const payload = normalizePayload(JSON.parse(complete[1]));
      if (!payload) {
        throw new Error("Invalid ClickUp ticket payload");
      }
      return {
        status: "valid",
        payload,
        displayText: [before, after].filter(Boolean).join("\n\n"),
      };
    } catch {
      return {
        status: "invalid",
        payload: null,
        displayText: [
          before,
          "ClickUp returned ticket data that could not be displayed safely. Fetch the tickets again.",
          after,
        ].filter(Boolean).join("\n\n"),
      };
    }
  }

  function normalizePayload(value) {
    if (!isRecord(value) || !Array.isArray(value.tickets)) {
      return null;
    }
    const tickets = value.tickets.slice(0, 200).map(normalizeTicket).filter(Boolean);
    const workspace = isRecord(value.workspace) ? value.workspace : {};
    const bugs = tickets.filter((ticket) => ticket.category === "Bug").length;
    const improvements = tickets.filter((ticket) => ticket.category === "Improvement").length;
    const blocked = tickets.filter((ticket) => ticket.blocked).length;
    const overdue = tickets.filter((ticket) => ticket.overdue).length;

    return {
      workspace: {
        id: optionalString(workspace.id, 80),
        name: optionalString(workspace.name, 160) || "ClickUp Workspace",
        spaces: stringArray(workspace.spaces, 24, 160),
      },
      summary: {
        total: tickets.length,
        bugs,
        improvements,
        blocked,
        overdue,
      },
      tickets,
      notes: stringArray(value.notes, 12, 500),
    };
  }

  function normalizeTicket(value, index) {
    if (!isRecord(value)) {
      return null;
    }
    const id = optionalString(value.id, 120);
    const title = optionalString(value.title, 500);
    if (!id || !title) {
      return null;
    }
    const category = String(value.category || "").toLowerCase() === "improvement"
      ? "Improvement"
      : "Bug";
    return {
      rank: safeRank(value.rank, index + 1),
      id,
      category,
      title,
      status: optionalString(value.status, 120) || "Unknown",
      dueDate: optionalString(value.dueDate, 120),
      overdue: value.overdue === true,
      blocked: value.blocked === true,
      assignees: stringArray(value.assignees, 30, 160),
      list: optionalString(value.list, 240),
      priority: optionalString(value.priority, 120),
      url: isSafeClickUpTicketUrl(value.url) ? value.url : null,
      whyActionable: optionalString(value.whyActionable, 1200),
    };
  }

  function extractLegacyMarkdownPayload(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const headerIndex = lines.findIndex((line) => {
      const cells = splitMarkdownTableRow(line).map(normalizeHeader);
      return cells.includes("rank") && cells.includes("ticket") && (
        cells.includes("type") || cells.includes("category")
      );
    });
    if (headerIndex < 0 || !isMarkdownSeparatorRow(lines[headerIndex + 1])) {
      return null;
    }

    const headers = splitMarkdownTableRow(lines[headerIndex]).map(normalizeHeader);
    const column = (...names) => headers.findIndex((header) => names.includes(header));
    const rankColumn = column("rank");
    const ticketColumn = column("ticket", "title");
    const categoryColumn = column("type", "category");
    const actionabilityColumn = column("actionability", "why actionable", "whyactionable");
    const statusColumn = column("status");
    const priorityColumn = column("priority");
    const dueColumn = column("due", "due date", "duedate");
    const assigneesColumn = column("assignees", "assignee");
    const listColumn = column("list/space", "list", "space");
    const urlColumn = column("url", "link");
    const sharedStatus = inferLegacyStatus(text);
    const tickets = [];
    let rowEnd = headerIndex + 2;

    for (; rowEnd < lines.length; rowEnd += 1) {
      if (!/^\s*\|/.test(lines[rowEnd])) {
        break;
      }
      const cells = splitMarkdownTableRow(lines[rowEnd]);
      if (cells.length < headers.length - 1) {
        break;
      }
      const ticketCell = cells[ticketColumn] || "";
      const parsedTicket = parseLegacyTicketCell(ticketCell);
      if (!parsedTicket.id || !parsedTicket.title) {
        continue;
      }
      const categoryText = stripMarkdownInline(cells[categoryColumn] || "");
      const category = /^improvement$/i.test(categoryText) ? "Improvement" : "Bug";
      const actionability = stripMarkdownInline(cells[actionabilityColumn] || "");
      const dueText = stripMarkdownInline(cells[dueColumn] || "");
      const urlText = stripMarkdownInline(cells[urlColumn] || "");
      const status = stripMarkdownInline(cells[statusColumn] || "") || sharedStatus || "Unknown";
      const rank = Number.parseInt(stripMarkdownInline(cells[rankColumn] || ""), 10);
      tickets.push({
        rank: Number.isInteger(rank) && rank > 0 ? rank : tickets.length + 1,
        id: parsedTicket.id,
        category,
        title: parsedTicket.title,
        status,
        dueDate: isMissingLegacyValue(dueText) ? null : dueText,
        overdue: /\boverdue\b/i.test(dueText),
        blocked: /\bblocked?\b/i.test(`${status} ${actionability}`),
        assignees: splitLegacyAssignees(cells[assigneesColumn]),
        list: nullableLegacyValue(cells[listColumn]),
        priority: nullableLegacyValue(cells[priorityColumn]),
        url: parsedTicket.url || urlText || null,
        whyActionable: actionability || null,
      });
    }

    if (tickets.length === 0) {
      return null;
    }

    const workspaceMatch = /(?:active authorized\s+)?Workspace:\s*(?:\*\*)?([^*(`\n]+?)(?:\*\*)?\s*\(\s*`?([^`\s)]+)`?\s*\)/i.exec(text);
    const spaceMatch = /containing\s+the\s+(?:\*\*)?([^*\n]+?)(?:\*\*)?\s+Space\b/i.exec(text);
    const notesText = lines.slice(rowEnd).join("\n").trim();
    const notes = notesText
      ? notesText
        .split(/\n\s*\n/)
        .map((note) => stripMarkdownInline(note).replace(/\s+/g, " ").trim())
        .filter(Boolean)
      : [];

    return {
      workspace: {
        id: workspaceMatch ? workspaceMatch[2] : null,
        name: workspaceMatch ? workspaceMatch[1].trim() : "ClickUp Workspace",
        spaces: spaceMatch ? [spaceMatch[1].trim()] : [],
      },
      tickets,
      notes,
    };
  }

  function splitMarkdownTableRow(line) {
    const value = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    return value.split("|").map((cell) => cell.trim());
  }

  function isMarkdownSeparatorRow(line) {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function normalizeHeader(value) {
    return stripMarkdownInline(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function parseLegacyTicketCell(value) {
    const markdownLink = /\[([^\]]+)\]\(([^)\s]+)\)\s*(?:[—–-]\s*)?(.*)/.exec(value);
    if (markdownLink) {
      return {
        id: stripMarkdownInline(markdownLink[1]),
        url: markdownLink[2],
        title: stripMarkdownInline(markdownLink[3]),
      };
    }
    const plain = stripMarkdownInline(value);
    const ticket = /^([a-z][a-z0-9]*-\d+)\s*(?:[—–-]\s*)?(.*)$/i.exec(plain);
    return ticket
      ? { id: ticket[1], url: null, title: ticket[2].trim() }
      : { id: null, url: null, title: null };
  }

  function inferLegacyStatus(text) {
    const match = /\bAll\s+(?:\w+|\d+)\s+(?:tickets?\s+)?are\s+[`*_]*([^`,.*\n]+)[`*_]*\s*,/i.exec(text);
    return match ? stripMarkdownInline(match[1]) : null;
  }

  function splitLegacyAssignees(value) {
    const normalized = stripMarkdownInline(value || "");
    if (isMissingLegacyValue(normalized)) {
      return [];
    }
    return normalized.split(/,\s*|\s+and\s+/i).map((name) => name.trim()).filter(Boolean);
  }

  function nullableLegacyValue(value) {
    const normalized = stripMarkdownInline(value || "");
    return isMissingLegacyValue(normalized) ? null : normalized;
  }

  function isMissingLegacyValue(value) {
    return !value || /^(?:-|—|–|none|n\/a|not set|no due date)$/i.test(value.trim());
  }

  function stripMarkdownInline(value) {
    return String(value || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
  }

  function isSafeClickUpTicketUrl(value) {
    if (typeof value !== "string") {
      return false;
    }
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname.toLowerCase() === "app.clickup.com" &&
        /^\/t\/[a-z0-9_-]+\/?$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function optionalString(value, maxLength) {
    if (typeof value !== "string") {
      return null;
    }
    const result = value.trim();
    return result ? result.slice(0, maxLength) : null;
  }

  function stringArray(value, maxItems, maxLength) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => optionalString(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  function safeRank(value, fallback) {
    return Number.isInteger(value) && value > 0 ? Math.min(value, 100000) : fallback;
  }

  return {
    extractClickUpPayload,
    isSafeClickUpTicketUrl,
  };
});
