# Puneet 3.0

Puneet 3.0 is a local-only VS Code coding-agent workbench powered by OpenAI's documented local Codex app-server. It brings workspace-aware chat, streamed agent progress, approvals, file-change cards, and editor-native change review into one sidebar.

> **Local development project:** Puneet 3.0 is not affiliated with, endorsed by, sponsored by, or supported by OpenAI. OpenAI, ChatGPT, and Codex are trademarks of OpenAI, LLC.

## Highlights

- Sign in with ChatGPT and use the Codex access included with an eligible plan.
- Sign in with an OpenAI API key for usage-based Platform billing.
- Discover available models and show account usage windows when the runtime provides them.
- Choose **Agent** to make changes, **Plan** to propose an implementation plan, **TAD** to turn the current plan and repository context into a Technical Architecture Document, or **ClickUp** to fetch tickets assigned to your authenticated ClickUp user.
- Save completed Plan-mode responses as Markdown files under `.puneet/plans` and reopen them from compact chat cards.
- Save completed TAD-mode responses under `.puneet/tads`, with Purpose, High-level overview, Technical flow, Setup/configuration, Usage examples, and useful Mermaid diagrams.
- Fetch incomplete assigned tickets from the active authorized ClickUp Workspace with a bundled read-only ClickUp skill, then review them as expandable Bug/Improvement cards with safe **Open in ClickUp** actions.
- Summarize a ticket in chat or confirm **Go/No** before switching to Agent mode to implement a focused fix.
- Answer Codex questions and option prompts directly inside the chat transcript.
- Start, resume, steer, interrupt, and compact local coding-agent conversations.
- Browse workspace-scoped previous chats.
- Stream assistant messages plus command, file, tool, search, and agent activity.
- See changed-file cards with added/deleted counts and compact patch previews.
- Review edits in the original editor with per-hunk **Undo** and **Keep** actions.
- Hover highlighted changes to compare the previous and current code.
- Select code to reveal an editor-native **Add to Chat** action.
- Approve or decline command execution, file changes, and permission requests.
- Run with `workspace-write` sandboxing and `on-request` approvals by default.

## Requirements

- Visual Studio Code 1.100 or newer.
- A trusted local folder open in VS Code.
- A current Codex CLI available as `codex`, or its absolute path configured in `puneet2.cliExecutable`.

Install the Codex CLI:

```bash
npm install --global @openai/codex
```

Puneet 3.0 also detects the Codex executable bundled with the ChatGPT macOS application.

ClickUp mode requires the official ClickUp MCP server to be registered and authenticated in the same Codex runtime:

```bash
codex mcp add clickup --url https://mcp.clickup.com/mcp
codex mcp login clickup
```

Finish the browser authorization, restart the extension, then select **ClickUp** in the mode picker. Selecting it automatically fetches incomplete tickets assigned to the authenticated ClickUp user. The bundled workflow is intentionally read-only and does not create, update, move, assign, comment on, or delete ClickUp items.

## Getting started

1. Run `npm install`, then `npm run build`.
2. Open this repository in Visual Studio Code.
3. Press `F5` and choose **Run Puneet 3.0** if prompted.
4. In the Extension Development Host, open a trusted local project folder.
5. Select **Puneet 3.0** in the Activity Bar.
6. Sign in with ChatGPT or an OpenAI API key.
7. Enter a prompt and review the resulting edits in chat and in the original editor, or select **ClickUp** to fetch your assigned tickets.

Useful slash commands include `/new`, `/stop`, `/status`, `/compact`, `/review`, `/model`, `/init`, and `/help`.

## How it works

Puneet 3.0 starts `codex app-server --listen stdio://` locally and communicates with it using newline-delimited JSON-RPC. The Codex runtime owns authentication, configuration, thread persistence, account limits, sandboxing, model access, and agent execution. Puneet 3.0 owns the VS Code interface.

The app-server connection stays on local stdio. Puneet 3.0 does not expose it over a network port.

Official references:

- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [Open-source Codex repository](https://github.com/openai/codex)

## Settings

- `puneet2.cliExecutable`: path to a Codex CLI executable.
- `puneet2.model`: optional server model override.
- `puneet2.reasoningEffort`: optional reasoning effort for turns.
- `puneet2.planDirectory`: workspace-relative folder for generated Markdown plans; defaults to `.puneet/plans`.
- `puneet2.tadDirectory`: workspace-relative folder for generated Technical Architecture Documents; defaults to `.puneet/tads`.
- `puneet2.sandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `puneet2.approvalPolicy`: `on-request`, `untrusted`, or `never`.
- `puneet2.inlineReview.enabled`: show editor-native review highlights, actions, and hover diffs.
- `puneet2.selectionAction.enabled`: show **Add to Chat** above selected code.

## Data and privacy

Puneet 3.0 does not include extension telemetry and does not operate a separate backend. Prompts, selected code, files, and tool results may be processed by OpenAI through the local Codex runtime according to the account and authentication method you choose. The runtime manages credentials and conversation storage.

See `PRIVACY.md` for the complete data-flow summary.

## Security

Coding agents can execute commands and change files. Puneet 3.0 requires a trusted workspace, defaults to workspace-scoped filesystem access, and displays approval requests for elevated actions. Review every proposed command and change before approving it.

See `SECURITY.md` before reporting a vulnerability.

## Development

```bash
npm install
npm test
npm run build
```

Open this folder in VS Code and press `F5` to launch the **Run Puneet 3.0** Extension Development Host. This project intentionally has no Marketplace packaging or publishing workflow.

## Current boundaries

Puneet 3.0 implements the core local coding loop but not every feature in OpenAI's first-party surfaces. Editor review uses stable VS Code decoration, hover, and CodeLens APIs; third-party extensions cannot reproduce private Cursor or first-party editor view-zone implementations exactly.

Unsaved files and files discovered only after a turn begins may be keep-only to avoid overwriting user work. Cloud task execution, worktree management, voice, image attachments, plugin management, and enterprise attestation UI are outside this local build. ClickUp support is limited to read-only ticket retrieval through an explicitly configured MCP connection.

## License and support

Puneet 3.0 is available under the MIT License. See `SUPPORT.md` for local troubleshooting.
