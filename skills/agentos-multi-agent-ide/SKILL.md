---
name: agentos-multi-agent-ide
description: Coordinate portable Br3eze AgentOS skills across Claude Code, Codex, Cursor, VS Code and other supported agents/IDEs through adapters, common tool contracts, durable WBS tasks and one execution owner.
---

# Multi-Agent and IDE Coordinator

## Architecture

Separate the portable layer from host-specific integrations:

1. **Portable skills** — `skills/<name>/SKILL.md` with consistent metadata, inputs, workflow, permissions, outputs and acceptance checks.
2. **WBS/workflow contracts** — durable task IDs, owners, dependencies, status, approvals and evidence.
3. **Canonical execution** — `src/core/agentRuntime.js`; no per-IDE runtime fork.
4. **Tool interfaces** — use existing CLI, gateway, API and adapters; expose MCP only through a real, documented MCP server implementation.
5. **Host adapters** — Claude Code plugin, skills.sh packages, and future IDE-specific manifests generated or maintained from the same canonical skill sources.
6. **Observation** — normalized events from connected sources with redaction and explicit source coverage.

## Workflow

- Detect host and available integrations; do not assume the presence of a connector or invoke an undocumented command.
- Load the narrowest specialist skill and assign one accountable owner.
- Delegate through WBS task contracts, not parallel copies of the same work.
- Use idempotency keys and durable event/task IDs to prevent duplicate execution.
- Return artifacts and evidence to the shared project record; record host-specific metadata only as adapter metadata.
- Validate package metadata and examples without requiring heavy runtime dependencies.
- If an IDE cannot consume the native format, provide the portable Markdown skill plus a thin documented adapter instead of rewriting the skill logic.

## Safety

Credentials remain in the user's approved environment. Host adapters do not inherit production privileges by default. Human approval is required for destructive changes, privileged user administration, payments, production deploys, Android publication and required-check bypasses.

## Output

Detected hosts and tool availability, chosen owner, task IDs, adapters used, evidence, gaps and next priority.
