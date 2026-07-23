# SCOPE – AI Coding Agent for VS Code

SCOPE is an unofficial VS Code coding-agent workbench powered by OpenAI's documented local Codex app-server. It brings workspace-aware chat, streamed agent progress, approvals, file-change cards, and editor-native change review into one sidebar.

> **Independent project:** SCOPE is not affiliated with, endorsed by, sponsored by, or supported by OpenAI. OpenAI, ChatGPT, and Codex are trademarks of OpenAI, LLC. SCOPE does not copy the proprietary source, visual identity, telemetry identity, or Marketplace branding of OpenAI's extension.

## Highlights

- Sign in with ChatGPT and use the Codex access included with an eligible plan.
- Sign in with an OpenAI API key for usage-based Platform billing.
- Discover available models and show account usage windows when the runtime provides them.
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
- A current Codex CLI available as `codex`, or its absolute path configured in `codexAgent.cliExecutable`.

Install the Codex CLI:

```bash
npm install --global @openai/codex
```

SCOPE also detects the Codex executable bundled with the ChatGPT macOS application.

## Getting started

1. Install SCOPE from the Visual Studio Marketplace or from a release VSIX.
2. Open a trusted local project folder.
3. Select **SCOPE** in the Activity Bar.
4. Sign in with ChatGPT or an OpenAI API key.
5. Enter a prompt describing the change you want.
6. Review the resulting edits in chat and in the original editor.

Useful slash commands include `/new`, `/stop`, `/status`, `/compact`, `/review`, `/model`, `/init`, and `/help`.

## How it works

SCOPE starts `codex app-server --listen stdio://` locally and communicates with it using newline-delimited JSON-RPC. The Codex runtime owns authentication, configuration, thread persistence, account limits, sandboxing, model access, and agent execution. SCOPE owns the VS Code interface.

The app-server connection stays on local stdio. SCOPE does not expose it over a network port.

Official references:

- [Codex app-server](https://developers.openai.com/codex/app-server)
- [Codex authentication](https://developers.openai.com/codex/auth)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [Open-source Codex repository](https://github.com/openai/codex)

## Settings

- `codexAgent.cliExecutable`: path to a Codex CLI executable.
- `codexAgent.model`: optional server model override.
- `codexAgent.reasoningEffort`: optional reasoning effort for turns.
- `codexAgent.sandbox`: `read-only`, `workspace-write`, or `danger-full-access`.
- `codexAgent.approvalPolicy`: `on-request`, `untrusted`, or `never`.
- `codexAgent.inlineReview.enabled`: show editor-native review highlights, actions, and hover diffs.
- `codexAgent.selectionAction.enabled`: show **Add to Chat** above selected code.

The `codexAgent.*` setting prefix is retained for compatibility with earlier local builds.

## Data and privacy

SCOPE does not include extension telemetry and does not operate a separate backend. Prompts, selected code, files, and tool results may be processed by OpenAI through the local Codex runtime according to the account and authentication method you choose. The runtime manages credentials and conversation storage.

Read [PRIVACY.md](PRIVACY.md) for the complete data-flow summary.

## Security

Coding agents can execute commands and change files. SCOPE requires a trusted workspace, defaults to workspace-scoped filesystem access, and displays approval requests for elevated actions. Review every proposed command and change before approving it.

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Development

```bash
npm install
npm test
npm run build
npm run package
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

## Current boundaries

SCOPE implements the core local coding loop but not every feature in OpenAI's first-party surfaces. Editor review uses stable VS Code decoration, hover, and CodeLens APIs; third-party extensions cannot reproduce private Cursor or first-party editor view-zone implementations exactly.

Unsaved files and files discovered only after a turn begins may be keep-only to avoid overwriting user work. Cloud tasks, worktree management, voice, image attachments, plugin management, and enterprise attestation UI are outside this v1 release.

## License and support

SCOPE is released under the [MIT License](LICENSE). See [SUPPORT.md](SUPPORT.md) for troubleshooting and support channels.
