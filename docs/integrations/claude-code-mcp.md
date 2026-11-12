# Claude Code MCP integration test

This repository's project-scoped `.mcp.json` intentionally registers **only** the offline AgentOS mock market-data server. It returns synthetic fixtures and has no network access, credentials, brokerage/account connection, or transaction tools.

## Requirements

- Node.js 22
- Claude Code installed locally

## Configure and verify

From the repository root:

```sh
claude mcp list
claude mcp get agentos-mock-market-data
```

Start or restart Claude Code in the repository. Approve the project-scoped server when Claude Code asks; then run `/mcp` and confirm the server is connected. Ask Claude to call `mock_market_snapshot` with symbol `DEMO`. The response must contain `"live":false` and `"source":"synthetic-fixture"`.

Run the standalone protocol tests:

```sh
node --test tests/integrations/mcp/mock-market-data-server.test.js
```

The test suite checks initialization, tool discovery, deterministic output, input validation, unknown tools, and JSON-RPC error behavior without contacting an external service.

## Safety boundary

Do not add real trading or gambling-service endpoints to this shared project configuration. Any future external adapter needs a separate review and should not inherit credentials or permissions from this mock server. The mock is for testing MCP plumbing, not for decision-making or real-world market activity.
