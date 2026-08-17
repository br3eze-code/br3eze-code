# AgentOS Domain-Agnostic Contract

## Acceptance rule

> If changing the customer's industry requires modifying AgentOS Core, AgentOS is not domain-agnostic.

AgentOS Core owns durable coordination concepts: organisations, principals, roles, functions, projects, assignments, skills, capabilities, authority, capacity, policy, workflow, resources, tools, work, loops, actions, evidence, outcomes, and audit records. It must not import or name a customer industry, device protocol, payment provider, channel vendor, or regional operating model.

## Boundary model

| Layer | Owns | Must not own |
|---|---|---|
| AgentOS Core | Work/Loop/Action/Evidence, FSM transitions, authority, policy, assignment, audit, tenant scope, capacity, generic resource and tool contracts | MikroTik, RouterOS, Wi-Fi, Starlink, Power Connect, commerce, Stripe, GitHub, Firebase, Cordova |
| Adapter contract | Capability declaration, validation, execution, normalization, health, and error translation for one external domain | Tenant authorization, acceptance-criteria mutation, direct channel identity trust, audit omission |
| Plugin registry | Registration, versioning, lifecycle, capability discovery, dependency checks, and isolation of adapters | Domain-specific orchestration semantics or bypasses around AgentOS policy |
| Specialist | Domain reasoning and selection of generic tools/adapters under an assigned Work | Direct privileged infrastructure access or redefining acceptance criteria |

## Adapter invariants

Every adapter must declare a stable type and version, expose only declared operations, validate its input, accept an immutable scoped execution context, return normalized observations, and translate provider failures into bounded error classes. Adapters may not select tenants, grant authority, or write audit records outside the AgentOS evidence path.

## Removable-domain test

The core-only test removes all domain adapters from the registry and verifies that AgentOS can still create an organisation, principal, role, project, assignment, generic skill, capability, policy, workflow, resource, tool, Work, Loop, Action, Evidence, Outcome, and audit record. A second test registers a synthetic adapter named `example.resource` and verifies that the same core path works without a network, commerce, or infrastructure import.

MikroTik, Stripe, GitHub, Starlink, Firebase, and Power Connect integrations remain supported, but they must be registered as plugins or adapters. Their package metadata, skills, routes, and tests may be domain-specific; AgentOS Core may not depend on them to load or execute its generic control-plane contracts.
