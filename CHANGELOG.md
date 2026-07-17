# Changelog

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
