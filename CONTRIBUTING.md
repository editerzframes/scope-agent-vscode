# Contributing

Development is currently local-only.

## Development setup

Requirements:

- Node.js 20 or newer;
- Visual Studio Code 1.100 or newer;
- a current Codex CLI for interactive testing.

Install and verify:

```bash
npm ci
npm test
npm run build
```

Press `F5` in Visual Studio Code to open an Extension Development Host.

## Change guidelines

- Keep changes focused and explain user-visible behavior.
- Add or update tests for parsing, protocol, and diff logic.
- Run `npm test`, `npm run check`, and `npm run build`.
- Do not commit credentials, local Codex state, or `node_modules`.
- Update `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
