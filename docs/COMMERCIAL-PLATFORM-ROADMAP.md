# AgentOS Commercial, Domain-Agnostic Platform Roadmap

## Architecture contract

The core owns runtime lifecycle, tool authorization, tenant scope, provider routing contracts, and audit events. Networking, payments, messaging, databases, MCP servers, and UI frameworks are integrations registered through explicit ports or plugins.

## Current implementation slice

- `src/adapters/mcp-client.js`: optional MCP client for stdio, SSE, and Streamable HTTP. It is dynamically loaded and does not force MCP SDK imports on core startup.
- `src/core/model-output.js`: strips raw `<think>` blocks. It intentionally does not persist or expose private chain-of-thought; provider-supported, user-safe reasoning summaries may be handled separately.
- `src/skills/loader.js`: reads YAML and SKILL.md front matter as metadata only. It does not execute third-party skill code.
- HITL approval lifecycle and delegated-tool factory are in `src/core/approval-gates.js` and `src/core/delegation.js` on the preceding feature branch.

## Security requirements before production

1. Treat MCP server configuration as administrator-controlled; never launch a command or URL selected directly by an end user.
2. Apply per-server tool allowlists, tenant authorization, schema validation, timeouts, output limits, and secret redaction before enabling remote tools.
3. Run untrusted skill code only in an isolated sandbox (container/WASM) with filesystem, network, CPU, memory, and wall-clock restrictions. Manifest parsing is not sandboxing.
4. Require durable atomic state transitions for approval decisions and execution claims.
5. Keep tenant identity server-derived; never trust tenant IDs supplied only in model-generated arguments.
6. Meter usage on the server and use durable idempotency keys for payment and credit mutations.
7. Stream only user-visible output, tool status, and provider-authorized summaries. Do not expose private chain-of-thought.

## Remaining roadmap

- Register MCP and skill-loader adapters through the canonical ToolRegistry / AgentRuntime composition root.
- Move networking and voucher implementations to separately installable plugins without breaking compatibility exports.
- Add plugin-provided CLI command registration.
- Add gateway streaming events, cancellation/backpressure, artifact schemas, and tenant-scoped quotas.
- Add integration tests for MCP disconnects, malicious manifests, cross-tenant calls, approval replay, and usage idempotency.
- Run unit tests, type/build checks, security audit, and architecture gates before merge.
