# Codex Agent Lab for VS Code

Codex Agent Lab is an unofficial, clean-room VS Code extension that connects to the documented local Codex app-server protocol. It is a functional foundation for a Codex-style coding agent: users can sign in, send workspace-aware prompts, stream progress, approve elevated actions, and let Codex make real code changes.

This project does not copy OpenAI's proprietary VS Code extension source, visual identity, telemetry identity, or marketplace branding. It identifies itself to app-server as `codex_agent_lab_vscode`.

## What works

- Sign in with ChatGPT in the browser and use the account's Codex entitlements and limits.
- Sign in with an OpenAI API key for usage-based Platform billing.
- Discover the models available to the signed-in account.
- Show primary and secondary Codex usage windows when provided by the account.
- Start, resume, steer, interrupt, and compact local Codex threads.
- Open a workspace-scoped Previous Chats drawer and resume an earlier conversation after starting a new one.
- Render a submitted prompt immediately while the local Codex runtime starts the turn.
- Stream assistant output and show command, file, tool, search, and agent activity.
- Show changed files directly in chat with live added/deleted counts and compact inline patch previews.
- Open a changed-file card in the original editor to review its pending inline changes.
- Keep a persistent live task card with the current step, elapsed time, quiet-period heartbeat, and explicit finished/failed/stopped state.
- Show running work in the VS Code status bar and Activity Bar badge, with completion notification when the sidebar is hidden.
- Run with `workspace-write` sandboxing and `on-request` approvals by default.
- Approve or decline command execution, file changes, and extra permission requests.
- Add the active file or an editor selection to a prompt.
- Snapshot open files before every turn, highlight changed hunks in the existing editor, and show clickable Keep/Undo pills with a red-before/green-after hover preview.
- Detect terminal-driven edits through the aggregated turn diff and an open-document before/after fallback.
- Keep or undo the whole active file from its editor-title or context-menu actions.
- Review uncommitted changes.
- Use `/new`, `/stop`, `/status`, `/compact`, `/review`, `/model`, `/init`, and `/help`.

## Architecture

The extension spawns `codex app-server --listen stdio://` locally and exchanges newline-delimited JSON-RPC messages with it. Codex owns authentication state, configuration, thread persistence, account limits, sandboxing, model access, and agent execution. The extension owns only the VS Code user experience and does not store account credentials.

Official references:

- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex IDE extension](https://developers.openai.com/codex/ide)
- [Codex open-source repository](https://github.com/openai/codex)

## Prerequisites

- VS Code 1.100 or newer.
- Node.js 20 or newer for development.
- A current Codex CLI available as `codex`, or an explicit path in `codexAgent.cliExecutable`.
- A trusted local folder open in VS Code.

The extension also checks the Codex binary bundled with the ChatGPT macOS app at `/Applications/ChatGPT.app/Contents/Resources/codex`.

## Run in development

```bash
npm install
npm run test
npm run build
```

Open this folder in VS Code and press `F5`. In the Extension Development Host, open a trusted code folder and select **Codex Agent Lab** in the Activity Bar.

## Package a VSIX

```bash
npm run package
```

Install the generated `.vsix` using **Extensions: Install from VSIX…**.

## Settings

- `codexAgent.cliExecutable`: path to a Codex CLI executable.
- `codexAgent.model`: optional server model override.
- `codexAgent.reasoningEffort`: optional reasoning effort for turns.
- `codexAgent.sandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `codexAgent.approvalPolicy`: `on-request`, `untrusted`, or `never`.
- `codexAgent.inlineReview.enabled`: highlight editor-native Codex changes, show clickable Keep/Undo pills, and display the before/after diff on hover.

## Security notes

- The default sandbox is `workspace-write`; the agent can change files in the active workspace.
- Elevated commands and additional permissions are presented as modal VS Code approvals.
- API keys are accepted through a password input and passed directly to the local Codex process. The extension does not write them to VS Code storage.
- Do not expose app-server over a public network. This implementation uses local stdio only.
- `danger-full-access` and `never` approvals are explicit opt-in settings.

## Current MVP boundaries

This release implements the core local coding loop, not every surface in OpenAI's evolving first-party extension. Compact inline review uses VS Code's stable decoration, hover, inlay-hint, and CodeLens APIs in the original editor; Cursor's private editor view-zone implementation is not exposed to regular VS Code extensions. Per-change and whole-file decisions are supported for files with a safe pre-turn snapshot. Unsaved files and files first discovered after the turn begins may be keep-only to avoid overwriting user work. Cloud tasks, worktree management, realtime voice, MCP elicitation forms, image attachments, plugin management, feedback upload, and enterprise attestation UI are future work. Unsupported app-server requests fail closed.

The next production milestone should add protocol-version compatibility tests against pinned Codex CLI releases, queued follow-ups, full MCP elicitation UI, and Windows/WSL runtime handling.
