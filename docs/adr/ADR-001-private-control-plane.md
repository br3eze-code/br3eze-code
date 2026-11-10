# ADR-001: Private AgentOS Control Plane and Local Execution

- **Status:** Proposed
- **Date:** 2026-11-10
- **Scope:** AgentOS, Br3eze Africa, Power Connect, and MikroTik edge nodes
- **Decision owners:** Repository maintainer, network administrator, and authorized legal and financial advisers

## 1. Context

AgentOS must support replaceable model, storage, payment, and infrastructure providers. It must retain one execution owner for each operation. It must separate public customer services from private management services.

The public website and payment callbacks require controlled public access. Router management, agent control, and internal databases must not have direct public access.

The repository identifies `src/core/agentRuntime.js` as the canonical execution owner. The repository also documents remaining legacy domain-specific modules. This ADR defines the target state. It does not claim that the current deployment meets it.

## 2. Decision

### 2.1 Trust domains

**Commercial and treasury domain**
- Own contracts, payment accounts, invoices, and financial reconciliation.
- Expose only approved application APIs and required payment callbacks.
- Do not store router administrator credentials.

**AgentOS control domain**
- Own task authorization, execution, verification, and audit events.
- Keep `src/core/agentRuntime.js` as the canonical execution owner.
- Use adapters for models, plugins, skills, storage, payments, and external protocols.
- Do not create a second execution loop for managed tasks.

**Local operational domain**
- Own router configuration, access points, local vouchers, and approved offline tasks.
- Use a unique identity and restricted account for each managed device.
- Reject unauthorized control requests.
- Continue only approved local functions during Internet outages.

### 2.2 Target port policy

| Service | Protocol and port | Policy |
|---|---|---|
| Public website and approved callbacks | TCP 443 | Public HTTPS |
| HTTP redirect | TCP 80 | Redirect to HTTPS only |
| WireGuard | UDP 51820 | VPN endpoint only |
| AgentOS HTTP API | TCP 3000 | Loopback or approved private interface |
| AgentOS gateway | TCP 19876 | Loopback by default |
| RouterOS API-SSL | TCP 8729 | Approved tunnel peers only |
| RouterOS API | TCP 8728 | Disable after adapter migration |
| SSH | TCP 22 | Approved tunnel peers only |
| WinBox | TCP 8291 | Approved tunnel peers only |
| WebFig HTTP | TCP 80 | Disable on router |
| WebFig HTTPS | TCP 443 | Disable unless required on an isolated management interface |
| Telnet | TCP 23 | Disable |
| FTP | TCP 21 | Disable |

The port table describes target policy. A service may use the same port number on a different host. Apply the policy to each host and interface.

RoMON uses Layer 2 frames. It does not use a TCP or UDP management port, and it does not provide encryption. Disable RoMON by default. Enable it only on an isolated Layer 2 management network when a documented requirement exists. Do not assume that a Layer 3 WireGuard tunnel carries RoMON frames.

### 2.3 Network rules

- Allow only required public application traffic.
- Allow WireGuard handshakes on the designated VPN endpoint.
- Allow management traffic only from approved tunnel peers.
- Reject unauthorized WAN management traffic.
- Block customer Wi-Fi clients from management services.
- Apply equivalent restrictions to IPv4 and IPv6.
- Do not expose the gateway, database, or internal diagnostics through the public reverse proxy.

Use unique WireGuard keys and unique peer addresses. Do not share private keys between devices. Limit peer routes to required destinations.

### 2.4 AgentOS listener policy

Use this baseline for a local-only deployment:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=19876
ALLOWED_ORIGINS=https://br3eze.africa
```

This example is not a complete deployment configuration. Confirm the variable names used by the selected entrypoint before applying it.

The gateway must require a stable credential from a secret manager or protected environment file. It must reject missing or invalid credentials. It must not log credentials or generate a new credential on every process start.

The public site may use an HTTPS reverse proxy. The proxy must expose only approved routes. It must not expose internal control endpoints.

Do not use wildcard CORS in production unless a documented public-resource design requires it. CORS is not authentication and does not replace server-side authorization.

### 2.5 Repository ownership

- AgentRuntime owns agent execution and lifecycle.
- One gateway component owns gateway lifecycle.
- One HTTP server component owns API routing and lifecycle.
- Domain adapters own vendor-specific operations.
- Persistence adapters own storage-provider access.
- Payment adapters own provider requests and webhook handling.
- Authorization runs before tool execution.
- Verification checks the result after tool execution.
- The PWA uses documented API contracts and does not implement a second agent loop.

A domain-neutral deployment must opt into domain capabilities. Do not load network or payment capabilities unless the deployment requires them.

### 2.6 Financial separation

The contracting principal owns customer contracts and payment-provider accounts. The Zimbabwe operating entity performs the local engineering and network work defined by a written agreement.

Each entity must keep its own legal identity, accounting records, and authorized bank accounts. The agreement must define service scope, eligible costs, markup, invoicing, settlement, tax treatment, and liability.

A cost-plus agreement must use documented costs and a supportable markup. It must not bypass payment-provider eligibility, tax obligations, or beneficial-ownership checks. A Dubai registration alone does not establish payment-provider eligibility. Obtain legal, tax, banking, and provider approval before launch.

### 2.7 Audit and data protection

Record actor identity, task identity, device identity, authorization result, timestamp, and operation outcome. Exclude passwords, private keys, payment credentials, and unnecessary customer data from logs.

Validate payment webhook signatures. Reject replayed or duplicate financial events. Use least-privilege accounts and explicit approval for disruptive operations.

## 3. Consequences

### Positive
- Public services and private management services have separate access policies.
- Providers can change behind stable interfaces.
- Local operations can continue within approved offline limits.
- Authorization and verification have explicit owners.
- Financial and hardware responsibilities have documented boundaries.

### Costs and limitations
- Legacy configuration and router adapters require review.
- WireGuard keys and device identities require lifecycle management.
- Offline operation requires reconciliation and conflict rules.
- Financial separation requires professional review.
- This ADR does not prove that any deployed device is secure.

## 4. Implementation steps

### Step 1: Record the baseline
1. Record the current `main` commit.
2. Export the router configuration securely.
3. Inventory active listeners, NAT rules, and firewall rules.
4. Inspect IPv4 and IPv6 policy.
5. List public endpoints and reverse-proxy routes.
6. Identify the active API and gateway entrypoints.
7. Save current CI results.

**Acceptance:** Each listener has an owner, purpose, interface, and access policy.

### Step 2: Secure one test edge node
1. Back up the router configuration.
2. Establish WireGuard access from an authorized peer.
3. Verify tunnel access before changing firewall policy.
4. Restrict management services to approved tunnel addresses.
5. Disable unused management services.
6. Test hotspot, DHCP, DNS, and customer traffic.
7. Test management access from an unauthorized WAN source.

**Acceptance:** Approved tunnel management works. Unauthorized public management fails. Customer access remains operational.

### Step 3: Secure AgentOS listeners
1. Inspect every server and gateway entrypoint.
2. Confirm the environment variable names for each entrypoint.
3. Set safe listener defaults.
4. Replace wildcard CORS with explicit origins where required.
5. Require gateway authentication.
6. Check every public route and proxy rule.
7. Confirm that production does not expose internal diagnostics.

**Acceptance:** The website works. Internal control endpoints remain private.

### Step 4: Enforce repository ownership
1. Keep AgentRuntime as the canonical execution owner.
2. Map all agent loops and gateway startup paths.
3. Move domain-specific tool declarations into adapters.
4. Remove duplicate lifecycle ownership only after tests identify the replacement.
5. Add tests for authorization, domain isolation, and provider failures.
6. Verify operation outcomes before reporting success.

**Acceptance:** Each operation has one execution owner. Each external operation passes through authorization and verification.

### Step 5: Validate release checks
1. Install dependencies using the repository's supported CI command.
2. Run repository hygiene and architecture gates.
3. Run authorization and authentication tests.
4. Run the complete test suite.
5. Run syntax and type checks.
6. Run security checks.
7. Validate each supported deployment profile.
8. Review all failures before merge.

**Acceptance:** Required CI checks pass on the candidate commit. No failing check is ignored.

### Step 6: Validate the commercial structure
1. Identify the contracting and operating entities.
2. Obtain legal and tax review.
3. Confirm payment-provider eligibility.
4. Document invoicing and settlement.
5. Test webhook signatures and duplicate-event handling.
6. Confirm accounting ownership for refunds and disputes.

**Acceptance:** Authorized advisers approve the structure and payment flows.

### Step 7: Release in stages
1. Deploy to one test node.
2. Test Internet loss and recovery.
3. Test credential revocation.
4. Test restart and rollback.
5. Verify public and private network boundaries.
6. Confirm audit events and alerts.
7. Expand only after all acceptance tests pass.

**Acceptance:** The test node meets the security, availability, and recovery requirements.

## 5. Follow-up ADRs

Create separate ADRs for:
- Offline task execution and reconciliation.
- Gateway authentication and device identity.
- PWA-to-API routing and production hosting.
- Payment webhook verification.
- RoMON use, if required.
- Database ownership, retention, backup, and recovery.

No ADR may introduce a second execution owner.

## 6. References

- Repository: https://github.com/br3eze-code/br3eze-code
- AgentRuntime: https://github.com/br3eze-code/br3eze-code/blob/main/src/core/agentRuntime.js
- Non-network deployment: https://github.com/br3eze-code/br3eze-code/blob/main/docs/architecture/non-network-deployment.md
- CI workflow: https://github.com/br3eze-code/br3eze-code/blob/main/.github/workflows/ci.yml
- RouterOS WireGuard: https://manual.mikrotik.com/docs/virtual-private-networks/wireguard/
- RouterOS security: https://manual.mikrotik.com/docs/getting-started/securing-your-router/
- RouterOS RoMON: https://help.mikrotik.com/docs/spaces/ROS/pages/8978569/RoMON
- Stripe global availability: https://stripe.com/global
