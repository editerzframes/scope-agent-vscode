# Security Policy

## Supported version

Security fixes are developed against the current local Puneet 3.0 branch.

## Reporting a vulnerability

Keep suspected vulnerabilities private and record them only in an appropriately protected local channel. Include:

- the affected Puneet 3.0 version;
- reproduction steps;
- the security impact;
- relevant logs with credentials, tokens, personal data, and proprietary source removed;
- any suggested mitigation.

Please allow reasonable time for validation and remediation before public disclosure.

## Security model

Puneet 3.0 can invoke a local coding agent that reads files, runs commands, and changes the active workspace. Its main safeguards are:

- Visual Studio Code Workspace Trust;
- Codex sandbox policies;
- explicit approval prompts;
- local stdio communication with app-server;
- snapshot-aware file review and guarded undo behavior.

The default configuration uses `workspace-write` sandboxing and `on-request` approvals. `danger-full-access` and the `never` approval policy materially reduce protection and should be used only in controlled environments.

## Secrets

Never include API keys, access tokens, private keys, credentials, proprietary code, or personal information in bug reports or screenshots. Revoke and rotate any credential that may have been exposed.
