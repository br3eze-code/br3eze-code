# Portable Specialist Operating Contract

This contract is the common baseline for Br3eze AgentOS skills. The standalone contract is also embedded in each skill so installing one skill does not require the entire repository.

## Required fields

Every skill must define a unique directory-matching `name`, a useful `description`, purpose, activation conditions, owned decisions, workflow, inputs, outputs, acceptance checks, safety boundaries and handoff rules.

## Work breakdown structure

Any multi-step project is represented as durable WBS activities. Each activity has:
- stable ID and parent activity;
- one accountable owner (collaborators are not co-owners);
- inputs, deliverables and explicit dependencies;
- estimate, risk, approval requirement and acceptance criteria;
- state, evidence references, last-updated timestamp and next action.

The coordinator maintains the plan; specialists perform only their owned work. A completed message is not evidence of completion.

## Portability

Canonical skill source: `skills/<name>/SKILL.md`. Use standard Markdown and YAML frontmatter; do not require a vendor runtime to read the instructions. Claude plugin commands, Codex/IDE manifests, skills.sh and MCP server configurations are adapters, not the source of truth.

## Runtime and tools

- One execution owner: `src/core/agentRuntime.js`.
- Reuse the existing CLI, gateway, API routes and provider adapters.
- Only describe MCP capabilities when an actual MCP server and its tool schemas exist and have been verified.
- Never duplicate business logic inside each IDE plugin.
- Skills are instructions; they do not themselves grant credentials, user permissions, local filesystem access or production access.

## Dependency policy

Prefer Node.js built-ins, platform APIs, existing packages and the committed lockfile. Before adding a dependency, document the missing capability, alternatives, maintenance/licence status, supply-chain risk, bundle/runtime impact and tests. Avoid adding dependencies for static validation that can be implemented with built-ins.

## Observation and evidence

Report source, timestamp, scope and evidence for each important status. Redact secrets and personal data. Separate observed facts, inference and unknowns. A cloud observer cannot see private local processes without an explicit secure bridge. Continuous observation requires opt-in, bounded rate, visible status and a stop mechanism.

## Approval gates

Require explicit approval for destructive or privilege-changing user administration, payment/refund actions, router/network changes, production deployments, Android publication, contractual commitments and required-check bypasses.

## Closeout

A WBS item is complete only when acceptance criteria are satisfied and evidence is attached. Summaries include unresolved blockers, rollback/recovery, and exactly one recommended next priority.
