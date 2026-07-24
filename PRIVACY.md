# Privacy

Last updated: July 23, 2026

Puneet 3.0 is a local Visual Studio Code extension. It does not include product analytics, advertising, or extension telemetry, and it does not operate a separate hosted backend.

## Data processed

When you ask Puneet 3.0 to perform a task, the local Codex runtime may process:

- prompts and follow-up messages;
- selected code and file references you attach;
- workspace files inspected or changed during a task;
- command output, diagnostics, diffs, and tool results;
- account identity and usage-limit information returned by the runtime.

This information may be sent to OpenAI by the Codex runtime according to the authentication method, account, workspace, and OpenAI service settings you use.

## Authentication

Puneet 3.0 supports the authentication flows exposed by the local Codex app-server:

- ChatGPT sign-in through a browser;
- OpenAI API-key sign-in.

Puneet 3.0 passes an entered API key directly to the local Codex process and does not write the key to extension storage. The Codex runtime is responsible for credential storage and refresh behavior.

## Local storage

Puneet 3.0 uses Visual Studio Code workspace storage for small interface preferences such as the last active thread identifier, selected model, Agent/Plan mode, and mappings between Plan items and their generated Markdown files. Completed plans are written to `.puneet/plans` by default, or to the workspace-relative directory selected in settings. Conversation history, Codex configuration, logs, and cached credentials are managed by the local Codex runtime, normally under its configured Codex home directory or operating-system credential store.

## Third parties

Puneet 3.0 depends on Visual Studio Code, the local OpenAI Codex runtime, and the services selected by that runtime. Their respective privacy terms apply:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
- [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)

## Your controls

You can:

- review and remove attached prompt context before sending;
- stop a running task;
- reject proposed permissions and file changes;
- sign out to ask the Codex runtime to clear its active credentials;
- stop using the local Puneet 3.0 development host and remove its Visual Studio Code workspace storage.

For privacy questions, use the support channel described in `SUPPORT.md`.
