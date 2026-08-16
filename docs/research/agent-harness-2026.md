# Agent Harness and A2A Research Notes

Research date: 2026-08-16.

## Findings

Current 2026 agent-harness literature and engineering guidance consistently emphasizes a controllable execution loop rather than an unconstrained chatbot. The recurring production concerns are explicit planning and execution boundaries, context management, sandboxing, approval/governance, observability across parent and child-agent spans, recovery/retry semantics, and evaluation of trajectories rather than only final text.

The 2026 survey result describes the harness as an architecture that makes agent behavior controllable and observable, with governance and evaluation treated as first-class concerns. The 2026 observability paper specifically frames harness evolution around observability of components, trajectories, and decisions.

A2A’s current primary materials describe a task-oriented protocol. Tasks have stable IDs and a lifecycle, and long-running work needs explicit status and result handling rather than a one-shot request/response assumption. The A2A repository also highlights dynamic UX negotiation and task lifecycle support. For AgentOS this implies that sub-agent calls need correlation IDs, parent/child task linkage, explicit submitted/working/completed/failed/canceled states, bounded retries, and durable result/error envelopes.

For Obsidian, the relevant ecosystem direction is local-vault automation through plugin APIs or secure local REST integrations. The implementation must not assume that a vault path is globally available, must avoid loading the entire vault into memory, and should use scoped file operations, idempotent writes, conflict-safe updates, and explicit authentication when crossing the local REST boundary.

## Sources

1. https://arxiv.org/html/2604.25850v1 — Observability-Driven Automatic Evolution of Coding-Agent Harnesses.
2. https://openreview.net/pdf?id=eONq7FdiHa — Agent harness engineering: A survey.
3. https://github.com/a2aproject/A2A — Official Agent2Agent protocol repository.
4. https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ — Google announcement describing A2A task-oriented interoperability.
5. https://www.ibm.com/think/topics/agent2agent-protocol — Overview of A2A task lifecycle concepts.
6. https://community.obsidian.md/plugins — Obsidian plugin ecosystem and local automation context.
7. https://community.obsidian.md/plugins/vault-retrieval — Example of vault retrieval, re-embedding, and offline edit handling.
8. https://community.obsidian.md/plugins/render-api — Example of a local REST API exposing vault-aware functionality.
