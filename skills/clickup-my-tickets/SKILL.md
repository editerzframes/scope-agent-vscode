---
name: clickup-my-tickets
description: Fetch and summarize the current authenticated user's assigned incomplete ClickUp Bug and Improvement tickets through the ClickUp MCP server. Use when asked for my ClickUp tickets, assigned bugs, improvements, active work, overdue work, ticket details, or read-only ClickUp triage.
---

# ClickUp My Tickets

Use the ClickUp MCP server to retrieve the authenticated user's assigned work. Keep this workflow strictly read-only.

## Workflow

1. Confirm that ClickUp MCP tools are available. If they are unavailable or unauthenticated, state that ClickUp is not connected to this Codex runtime and stop.
2. Call `clickup_get_workspace_hierarchy` with depth `0` and identify the active Workspace ID plus its top-level Spaces. The official MCP connection exposes one active authorized Workspace context; do not claim that a single query covered other Workspaces.
3. Resolve "me" from the authenticated ClickUp identity or an MCP tool that supports the current user. Do not assume that the Codex or ChatGPT account email matches ClickUp.
4. Resolve the `Bingo Bash - Bugs` list from the hierarchy. In Workspace `68051`, its current list ID is `901611849101`; verify the location rather than using that ID in a different Workspace.
5. Run two assigned-ticket queries with `clickup_filter_tasks`, `include_closed: false`, `subtasks: true`, and page `0`:
   - Bug query: filter by the resolved `Bingo Bash - Bugs` list ID and the authenticated user ID.
   - Improvement query: filter by tag `improvement` and the authenticated user ID.
   Continue incrementing each page until it is empty when pagination is needed. Do not use `clickup_search` for this listing; reserve it for keyword searches.
6. Merge both result sets by task ID. Label a task `Improvement` when its normalized tags include `improvement`; otherwise label a task from the Bug list `Bug`. Do not infer either category from title text.
7. ClickUp can return custom completion statuses even when `include_closed` is false. Remove tasks whose normalized status is `done`, `closed`, `complete`, `completed`, or `archived`. Treat the remaining custom statuses as incomplete unless their task data proves otherwise.
8. Include other task types, or closed and completed tasks, only when the user explicitly asks.
9. Minimize MCP calls. Fetch full task details, comments, or related Docs only for a specific ticket or when required to answer the request.
10. Sort overdue tickets first, then upcoming due dates, then tickets without due dates. Use blocked status and priority as secondary signals.

## Default response

After the read-only fetch completes, return exactly one fenced `clickup-tickets` JSON block. This is a machine-readable UI contract, not an optional formatting preference. Never return a Markdown table, including when earlier messages used one. A short sentence may precede the block, but put all ticket data in this contract:

```clickup-tickets
{
  "workspace": {
    "id": "68051",
    "name": "Workspace",
    "spaces": ["BingoProjectManagement"]
  },
  "summary": {
    "total": 2,
    "bugs": 1,
    "improvements": 1,
    "blocked": 0,
    "overdue": 1
  },
  "tickets": [
    {
      "rank": 1,
      "id": "BB-86022",
      "category": "Bug",
      "title": "Cooldown timestamp is not initialized",
      "status": "Open",
      "dueDate": "2026-07-24",
      "overdue": true,
      "blocked": false,
      "assignees": ["Puneet Garg"],
      "list": "Bingo Bash - Bugs",
      "priority": "High",
      "url": "https://app.clickup.com/t/86d3tzb0g",
      "whyActionable": "Recently updated and has clear reproduction steps."
    }
  ],
  "notes": ["Nothing was modified."]
}
```

Before responding, verify that the final answer contains the literal opening fence named `clickup-tickets`, valid JSON matching the contract, and a closing fence. Produce strict JSON: use double quotes, no comments, and no trailing commas. Preserve the sorted ticket order as `rank`. Set unavailable scalar fields to `null`, unavailable arrays to `[]`, and boolean signals to `false`; do not invent values. Keep ticket IDs and URLs exact. Compute summary counts from the final filtered ticket list.

If the hierarchy exposes an unexpected onboarding or personal Workspace, stop before listing tickets and explain that ClickUp must be reauthorized for the intended Workspace.

## Safety

- Do not create, update, delete, move, assign, comment on, tag, or track time against any ClickUp item.
- Do not use shell commands, web search, or guessed ClickUp data as a fallback.
- Ask for explicit confirmation before any future request that would change ClickUp.
- If a later prompt requests a write, explain that ClickUp mode is read-only and suggest switching to Agent only after the host adds an approved write workflow.

## Follow-ups

For a selected ticket, retrieve the description, acceptance criteria, custom fields, dependencies, linked tasks, and comments that are relevant to the question. Summarize evidence clearly so the user can switch to Plan or TAD in the same chat without fetching the ticket again.
