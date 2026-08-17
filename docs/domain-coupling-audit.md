# AgentOS Domain-Coupling Audit

## Decision summary

The repository is **not yet fully domain-agnostic**, although the control-plane architecture is moving in that direction. The current position is approximately **87/100 architecturally** and **72/100 in implementation**, pending removal of legacy domain imports and package identity coupling.

The strongest evidence is that `src/core` still contains direct or name-level references to network, commerce, cloud, mobile, and provider domains. The scan found **926 matching lines in `src/core`** for terms such as MikroTik, RouterOS, Starlink, Power Connect, Wi-Fi billing, Firebase, Stripe, GitHub, and commerce. Some matches are legitimate adapter boundaries or documentation, but the count confirms that the core boundary is not yet clean.

## Coupling inventory

| Area | Finding | Severity | Required treatment |
|---|---|---:|---|
| Package description | Describes AgentOS as a MikroTik network-intelligence system | High | Replace with domain-neutral AgentOS positioning; preserve product-specific descriptions in adapter packages |
| Package dependencies | Network, Firebase, Cordova, RouterOS, and related dependencies are in the root package | High | Split core/runtime dependencies from optional adapter and client bundles |
| `src/core` | Contains provider and network modules such as `mikrotik.js`, `mikrotik-mesh.js`, `firebase.js`, `github.js`, and `telegram.js` | High | Move to `src/adapters`, `src/channels`, or plugin packages; keep only ports in core |
| Skills | Domain-specific skills coexist with core skills under broad skill roots | Medium | Classify skills as core, specialist, or adapter-owned and enforce manifest ownership |
| Legacy plugin registry | Registers built-in MikroTik/AWS/Docker/Kubernetes/Proxmox adapters directly | Medium | Treat as an integration registry outside the core kernel; require scoped execution context |
| Existing adapter work | `device-adapter.js`, inventory adapters, project-facts adapters, and health adapters already demonstrate a safer direction | Positive | Generalize their contracts and preserve their tenant/approval invariants |
| Tests | Existing tests mix core, adapter, channel, Cordova, and product behavior | Medium | Add a core-only test project or test command that excludes optional domains |

## Acceptance decision

The repository fails the strict removable-domain acceptance test today because removing network-specific modules would still affect package loading, root dependency installation, and parts of the `src/core` import graph. It passes the first architectural slice: the new `domain-kernel.js` contains only generic entities and can register a synthetic adapter without importing a network or commerce module.

## Remediation order

First, establish `src/core/ports` and `src/adapters` as explicit boundaries, and make core modules depend only on ports. Second, move channel, provider, payment, network, and mobile bootstrapping out of the core package entrypoint. Third, split package metadata into a domain-neutral AgentOS package and optional adapter/client workspaces. Fourth, add a core-only acceptance command that installs and tests without MikroTik, RouterOS, Firebase, Cordova, Stripe, or GitHub packages.

The repository should not be certified domain-agnostic until the core-only command succeeds with those adapters physically absent and the adapter suite succeeds when they are restored through plugin registration.
