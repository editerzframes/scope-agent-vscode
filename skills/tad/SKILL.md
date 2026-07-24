---
name: tad
description: Create an implementation-ready Technical Architecture Document (TAD) from the current conversation, an existing implementation plan, and repository evidence. Use when asked for a TAD, technical design, architecture document, solution design, technical flow, system design, or an engineering handoff that should include setup, usage, and appropriate Mermaid diagrams.
---

# Technical Architecture Document

Create one self-contained Markdown TAD. Treat the current conversation and the latest plan in the same chat as primary context, then inspect the repository only as needed to resolve technical details.

Do not edit implementation files. Do not create the document on disk; return the complete Markdown document so the host can save and link it.

## Workflow

1. Identify the proposed change, its boundaries, actors, dependencies, and expected outcome from the conversation and latest plan.
2. Inspect relevant source files, configuration, schemas, interfaces, and tests when repository evidence is needed.
3. Separate verified facts from assumptions. Never invent file paths, APIs, configuration keys, or runtime behavior.
4. Draft a decision-oriented document that another engineer can implement without reconstructing the design from chat history.
5. Add Mermaid diagrams only where they materially clarify relationships or behavior.
6. Check that every required section below is present before returning the document.

## Required document structure

Begin with `# Technical Architecture Document: <concise title>`.

Include these sections in this order:

1. `## Purpose`
   - State the problem, intended outcome, scope, and important non-goals.
2. `## High-level overview`
   - Summarize the proposed architecture, affected components, key decisions, and system boundaries.
3. `## Technical flow`
   - Describe the end-to-end behavior, including entry points, validation, data movement, state changes, errors, and relevant file or symbol references.
4. `## Setup/configuration`
   - List dependencies, feature flags, environment variables, migrations, permissions, deployment steps, and defaults. State `No additional setup required` when appropriate.
5. `## Usage examples`
   - Provide realistic examples such as requests, commands, configuration, code, or user journeys. Include expected results.

Add focused sections such as `Architecture and components`, `Data model`, `APIs and contracts`, `Security`, `Observability`, `Testing strategy`, `Rollout`, `Risks`, or `Open questions` only when they improve implementation readiness.

## Diagram guidance

Use fenced Mermaid blocks:

- `flowchart` for component relationships, processing stages, and decision paths.
- `sequenceDiagram` for requests, events, callbacks, and multi-service interactions.
- `stateDiagram-v2` for lifecycle or status transitions.
- `erDiagram` for persistent data relationships.

Prefer the smallest diagram that explains the design. Do not add a diagram merely for decoration. Use quoted node labels when text contains punctuation. Follow each diagram with one short paragraph explaining the important path or decision.

## Quality bar

- Anchor claims in repository evidence when available, using exact workspace-relative paths, symbols, and configuration names.
- Explain the proposed behavior rather than restating the prompt.
- Make alternatives and tradeoffs explicit when a design choice is non-obvious.
- Mark unresolved details under `Open questions` and state any working assumptions.
- Keep examples internally consistent with the proposed flow.
- Avoid implementation checklists that duplicate an existing plan; translate the plan into architecture and operational detail.
- Return only the final Markdown TAD, without conversational preamble or a trailing offer to continue.
