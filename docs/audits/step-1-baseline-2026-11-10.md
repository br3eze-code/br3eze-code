# Step 1 — Baseline and Audit

**Date:** 2026-11-10  
**Repository:** `br3eze-code/br3eze-code`  
**Baseline:** remote `main` source inspection; candidate documentation PR #274  
**Status:** Partial — source findings recorded; edge-device snapshot not supplied by a connected router session.

## 1.1 Source repository audit

### Canonical execution owner

- `src/core/agentRuntime.js` declares the domain-neutral runtime and owns tool orchestration, permissions, and verification integration.
- `src/core/ask-engine.js` states that it requires the canonical runtime and routes capabilities through runtime tools.
- `src/core/agentKernel.js` describes itself as a compatibility/control-plane facade and delegates tool execution to AgentRuntime.
- `src/harness/AgentHarness.js` uses the canonical runtime and its tool registry.
- The repository has a runtime-boundary audit script at `scripts/runtime-boundary-audit.mjs`. The presence of these contracts is evidence of intended ownership, not proof that every path complies. Run the architecture and runtime-boundary gates and inspect every reported exception before claiming a pass.

### Listener and origin configuration findings

| Location | Observed source default | Assessment |
|---|---|---|
| `src/cli/commands/gateway.js` | `config.gateway.host || '127.0.0.1'`; port defaults to `19876` | Gateway command defaults to loopback when config has no host. A config or CLI/environment override can change this. |
| `.env.example` | `SERVER_HOST=0.0.0.0`, `GATEWAY_HOST=0.0.0.0`; also has `GATEWAY_BIND=127.0.0.1` | Conflicting examples. Do not use this file alone as a production-safe configuration. |
| `agentos.js` | Joi defaults include `HOST=0.0.0.0` and `ALLOWED_ORIGINS=*` | Unsafe defaults if this legacy entrypoint is deployed directly. Verify deployment entrypoint before deciding whether it is internet-reachable. |
| `helm/agentos/templates/deployment.yaml` | `HOST=0.0.0.0`, `GATEWAY_HOST=0.0.0.0` | Container bind addresses are not by themselves proof of public exposure. Service type, ingress, network policy, and gateway authentication must be checked together. |
| `docker-compose.production.yml` | `GATEWAY_HOST=0.0.0.0`; requires gateway token and allowed origins | Requires a deployment review of published ports, reverse proxy, and firewall rules. |
| `apphosting.yaml` | `GATEWAY_HOST=0.0.0.0` | Must be reviewed against the hosting platform's ingress model and active entrypoint. |
| `server/src/core/configureHttpApplication.js` | Explicit origin allowlist; production does not add localhost origins automatically | Preserve this stricter boundary. Do not replace it with wildcard CORS. |

**Baseline conclusion:** The gateway CLI's fallback is loopback, but the repository as a whole is not consistently loopback-only. The legacy `agentos.js`, sample environment file, and container deployment manifests have broader bind/origin settings. No live listener, DNS, ingress, NAT, or firewall state was inspected in this source-only audit.

## 1.2 Local edge environment snapshot

**Not executed:** No authenticated RouterOS terminal/WinBox session or test-node export was available to this audit. No router configuration was changed.

Run the supplied read-only baseline command on the test router:

```routeros
/ip service print detail
/ip firewall filter print detail where chain=input
/interface wireguard print
```

Then capture and store the export securely:

```routeros
/export file=pre-adr-001-backup
```

For the full checklist, separately record IPv4 and IPv6 input filters, NAT rules, active TCP/UDP listeners, WireGuard peers and allowed-addresses, and service status for API (8728), API-SSL (8729), WebFig (80/443), SSH (22), WinBox (8291), and Telnet (23). Redact passwords, private keys, tokens, public IPs where needed, and customer identifiers before attaching evidence. Do not disable management services or apply firewall changes until out-of-band recovery access is confirmed.

## 1.3 CI validation

- The repository workflow `.github/workflows/ci.yml` includes repository hygiene, architecture and CI-quality gates, agent identity authorization, authentication, test suites, infrastructure reconciliation, syntax, type checks, and security audit.
- Candidate commit: `73a600f0b01b8b9aa7a878aeb96e7dcbd7e1ce3e` on PR #274.
- GitHub commit status was observed as **success** for Vercel and Snyk at the time of this snapshot.
- The workflow-run query returned no PR-triggered workflow-run records. Therefore this status snapshot does **not** establish that the full `.github/workflows/ci.yml` job completed successfully. Confirm the Actions run and each job directly before merge.
- No local test suite was run in this audit environment.

## Exit criteria before WireGuard policy changes

1. Identify and document the actual deployed entrypoint and listener configuration for each deployment target.
2. Resolve wildcard CORS and broad bind defaults where they are not required by the platform; require explicit, documented overrides where they are required.
3. Prove the runtime-boundary and architecture gates pass on the candidate commit.
4. Attach a redacted RouterOS export and IPv4/IPv6 firewall, NAT, listener, and management-service snapshots.
5. Verify out-of-band recovery and test the proposed WireGuard policy on the test node before applying it to production.
