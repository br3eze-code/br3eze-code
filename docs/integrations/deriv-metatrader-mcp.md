# Deriv and MetaTrader MCP integrations

These are optional, separate MCP stdio servers for AgentOS. They are deliberately **read-only**: no order placement, account funding, withdrawals, strategy execution, or trade modification tools are exposed. They are integration scaffolds, not a claim of live-account validation.

## Requirements

- Node.js 22 (the repository's supported runtime).
- Install the MCP SDK in the deployment that runs these servers: `npm install @modelcontextprotocol/sdk`.
- Deriv: set `DERIV_APP_ID` to a numeric application ID. No Deriv account token is required for the public market-data tools.
- MetaTrader: run a separately reviewed local bridge alongside a MetaTrader terminal and set `MT_BRIDGE_URL` (default `http://127.0.0.1:8787`). This MCP server does not include a terminal EA, broker login, or bridge implementation.

## Run

```sh
DERIV_APP_ID=YOUR_APP_ID node integrations/mcp/deriv-server.js
MT_BRIDGE_URL=http://127.0.0.1:8787 node integrations/mcp/metatrader-server.js
```

Each process speaks MCP over stdio; configure it as a separate server in the MCP client/AgentOS host. Do not launch either server from untrusted user-supplied command strings.

## Deriv tools

- `deriv_server_time`
- `deriv_active_symbols`
- `deriv_ticks_history`

The server opens a bounded-time WebSocket request per call. It does not authenticate with an account token or place trades.

## MetaTrader bridge contract

The bridge is an independently operated local service and should expose JSON GET endpoints:

- `GET /health`
- `GET /account`
- `GET /positions`
- `GET /symbols`
- `GET /rates?symbol=EURUSD&limit=100`

Response schemas are bridge-defined; normalize fields and redact account identifiers before exposing data to agents. Bind only to loopback, use an explicit allowlist, enforce local OS permissions, and never expose this bridge directly to the internet. The MCP server rejects non-loopback bridge URLs, redirects, non-JSON responses, and responses over 1 MB.

## Security and rollout gates

1. Keep account credentials in the terminal/bridge, never in MCP tool arguments or prompts.
2. Default to read-only permissions; any future trading capability requires a separate design, explicit per-order human confirmation, risk limits, idempotency, audit logs, and tests.
3. Treat prices and tool output as untrusted external data; never allow them to override AgentOS policy.
4. Add integration tests using mocked WebSocket/HTTP responses before enabling these servers in production.
5. Install the SDK only in deployments that need MCP; the core AgentOS runtime remains provider-agnostic.

## Known limitations

- Neither server has been connected to a real Deriv app ID or MetaTrader terminal in CI.
- MetaTrader connectivity depends on a bridge implementation compatible with the contract above; MT4/MT5 terminal APIs differ by platform and deployment.
- Market data is informational and can be delayed or unavailable. It is not investment advice.
