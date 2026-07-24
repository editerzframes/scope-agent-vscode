# Changelog

## 3.6.0

- Add **Summarize** and **Fix this** actions to expanded ClickUp ticket cards.
- Keep summaries read-only and require an in-chat Go/No confirmation before switching to Agent mode for a fix.
- Render Codex questions, choice descriptions, custom answers, secret inputs, and Skip actions directly in chat instead of the VS Code window bar.
- Validate ticket action data and question answers before forwarding them to the local Codex runtime.

## 3.5.1

- Convert legacy ClickUp Markdown tables into the same compact ticket cards, including existing chat history.
- Strengthen the automatic ClickUp prompt and bundled skill so new results use the structured card payload.
- Preserve safe URL validation while extracting legacy ticket links.

## 3.5.0

- Render structured ClickUp results as compact, expandable, theme-aware ticket cards.
- Preserve ClickUp-specific messages while streaming and reopening chat history.
- Collapse fetch progress into one inspectable activity row and show a loading skeleton while ticket JSON streams.
- Add safe DOM-based Markdown formatting and validated external links without using unsanitized HTML.
- Restrict ticket actions to valid `https://app.clickup.com/t/...` URLs.

## 3.4.0

- Make ClickUp mode default to incomplete assigned Bug and Improvement work.
- Resolve Bug work from the active Workspace's `Bingo Bash - Bugs` list.
- Treat `improvement` as a ClickUp tag, matching the live Workspace metadata, and combine it with Bug-list results.
- Deduplicate tickets and display an explicit Bug or Improvement category without guessing from title text.

## 3.3.2

- Use ClickUp's structured `filter_tasks` tool for assigned-ticket listings because global search can fail for otherwise authorized Workspaces.
- Exclude custom `done`, `closed`, `complete`, `completed`, and `archived` statuses locally because ClickUp can return them even with `include_closed: false`.
- Preserve pagination, subtasks, due-date ordering, and blocked-task prioritization for the resulting incomplete list.

## 3.3.1

- Reload MCP configuration and OAuth state before every automatic ClickUp fetch so a newly authorized Workspace works without restarting VS Code.
- Verify and display the active ClickUp Workspace context before retrieving assigned tickets.
- Stop claiming that one ClickUp MCP query searched Workspaces outside the active OAuth context.
- Detect unexpected onboarding or personal Workspace scopes before presenting irrelevant tickets.

## 3.3.0

- Add ClickUp as a fourth mode beside Agent, Plan, and TAD.
- Automatically fetch incomplete tickets assigned to the currently authenticated ClickUp user when ClickUp mode is selected.
- Search the active authorized ClickUp Workspace and prioritize overdue, upcoming, and undated tickets.
- Bundle and explicitly invoke a validated read-only ClickUp ticket skill.
- Check MCP availability, authentication, and tool inventory before starting the ticket fetch, with actionable setup errors.
- Keep fetched ticket context in the current chat so the user can switch to Plan or TAD for follow-up work.

## 3.2.0

- Add TAD as a third collaboration mode beside Agent and Plan.
- Bundle and explicitly invoke a validated TAD skill while preserving the current chat and latest-plan context.
- Generate implementation-ready Markdown documents with required Purpose, High-level overview, Technical flow, Setup/configuration, and Usage examples sections.
- Guide Codex to add Mermaid flow, sequence, state, or data diagrams only where they improve the design.
- Save completed TADs under `.puneet/tads` and reopen them from chat cards, the footer, or the command menu.
- Restore TAD cards correctly when reopening chat history.
- Add a configurable, workspace-relative `puneet2.tadDirectory` setting with traversal protection.

## 3.1.1

- Backfill earlier inline Plan items into Markdown files when their chat history loads.

## 3.1.0

- Save every completed Plan-mode response as a Markdown file under `.puneet/plans`.
- Replace full Plan output in chat with a compact clickable plan-file card.
- Add a Plans shortcut in the chat footer and command menu.
- Persist plan-item-to-file mappings so saved plans reopen correctly from chat history.
- Add a configurable, workspace-relative `puneet2.planDirectory` setting with traversal protection.

## 3.0.0

- Added a persistent Agent/Plan selector to the chat composer.
- Connected Plan to Codex app-server's native collaboration mode and defaulted it to medium reasoning unless configured otherwise.
- Streamed Plan output into the chat with a distinct visual treatment and restored completed plans from history.
- Disabled mode switching during an active turn so follow-ups stay in the running turn's mode.
- Updated the visible local extension branding to Puneet 3.0 while preserving the existing extension ID, settings, and workspace history.

## 2.0.1

- Show inline file review as soon as each file edit finishes while the rest of the turn continues.
- Wait briefly for completed edits to become visible on disk before displaying Keep/Undo controls.
- Restore the Puneet 2.0 icon for locally installed VSIX builds.

## 2.0.0

- Renamed the local extension to Puneet 2.0.
- Isolated commands, settings, storage, views, and the Activity Bar container under `puneet2`.
- Removed Marketplace publishing metadata, packaging scripts, and VSCE dependencies.
- Added the redesigned signed-in and signed-out landing experiences.
- Kept local coding, streaming, chat history, changed-file cards, inline review, and selected-code workflows.

## 0.10.0

- Added an editor-native Add to Chat action that appears above selected code.
- Captured the exact selected range when the action is clicked, even as focus moves to the chat sidebar.
- Prevented the same selected-code attachment from being added to the composer more than once.
- Kept Add to Chat in the editor context menu as a fallback when CodeLens is disabled.

## 0.9.0

- Moved each hunk's review controls onto a dedicated compact row above the changed block.
- Removed inline Keep/Undo pills so actions no longer displace or visually merge with source code.
- Ordered the actions as Undo then Keep to match the reference review flow.
- Retained the compact red/green hover diff and safe per-hunk rollback behavior.

## 0.8.0

- Replaced the default per-hunk CodeLens row with clickable inline Keep and Undo pills.
- Used two native inlay-hint kinds to visually distinguish Keep from Undo while respecting the active theme.
- Added configuration-aware CodeLens fallback when editor inlay hints are normally disabled.
- Kept the compact red/green hover diff and all safe per-hunk rollback behavior.

## 0.7.0

- Replaced expanded comment-thread panels with a compact native editor review.
- Kept per-hunk green highlights and shortened the actions to Keep and Undo.
- Added red-before/green-after diff previews when hovering any highlighted change block.
- Preserved deletion markers, whole-file actions, safe snapshot checks, and the v0.5.0 rollback checkpoint.

## 0.6.0

- Added expanded inline review blocks to the original editor for every pending diff hunk.
- Show previous code in red directly beside the green current code, including deletion-only changes.
- Added native Keep and Undo actions to each inline review block while retaining the safe snapshot checks.
- Fixed unified-diff handling for source lines that themselves begin with `---` or `+++`.

## 0.5.0

- Added live changed-file cards directly in the chat, with filenames and added/deleted line counts.
- Added compact inline patch previews styled like coding-agent chat change cards.
- Made each changed-file card open the original workspace file and reveal its pending inline review.
- Restored completed file cards when resuming a conversation whose history contains file-change events.

## 0.4.0

- Rebuilt inline review around pre-turn snapshots and the aggregated `turn/diff/updated` event.
- Added a before/after fallback for edits made through terminal commands.
- Added per-change Accept and Reject CodeLens actions in the original editor.
- Added Accept File and Reject File actions to the active editor title and context menu.
- Added guarded reverse-hunk application and newer-manual-edit protection.

## 0.3.0

- Added immediate optimistic prompt rendering, including startup progress before app-server responds.
- Added workspace-scoped previous-chat browsing and thread resumption.
- Added editor-native Codex change highlights with per-file Accept and Reject CodeLens actions.
- Added pending-edit review commands and a grouped inline-review notification.

## 0.2.0

- Added a persistent task lifecycle card with current activity, elapsed time, and completion state.
- Added a heartbeat that confirms Codex is still running during quiet periods.
- Added an Activity Bar badge and native VS Code status-bar progress indicator.
- Added a background completion notification when the Codex sidebar is hidden.

## 0.1.0

- Added ChatGPT browser login and API-key login through Codex app-server.
- Added account-aware models and usage-limit indicators.
- Added streamed local Codex threads with real workspace edits.
- Added command, file-change, permission, and user-input approval handling.
- Added file and editor-selection context.
- Added new chat, stop, review, compact, model, status, and init commands.
