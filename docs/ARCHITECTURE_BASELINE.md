# AgentOS Architecture Baseline

**Status:** Phase 0 — Frozen target  
**Canonical repository:** `br3eze-code/br3eze-code`  
**Canonical branch:** `main`

## 1. Purpose

AgentOS is a **domain-agnostic agent orchestration and execution system**.

The repository's `main` branch is the single source of truth. Architecture, implementation, tests, documentation, and operational configuration are evaluated and integrated through `main`.

## 2. Development boundary

This project intentionally uses a **main-only development model**.

- `main` is canonical.
- Do not create parallel architecture branches for alternative versions of AgentOS.
- Do not maintain numbered architecture snapshots such as `ss16`, `ss17`, `ss25`, or `ss34` as competing implementations.
- Do not create `final`, `final-v2`, `experimental`, or equivalent long-lived alternatives.
- Do not delete existing branches during Phase 0; branch cleanup is a later evidence-based activity.
- Changes are measured, reviewed, tested, and integrated into `main`.

This policy does not mean that Git branches can never be used temporarily by tooling. It means that **there is only one canonical product architecture: the one represented by `main`**.

## 3. Core responsibility

AgentOS Core owns generic orchestration capabilities such as:

- runtime and lifecycle
- agents
- tasks
- workflows
- events
- state
- identity
- authority and policy
- tool registration and execution
- model interfaces and execution
- memory interfaces
- persistence interfaces
- audit and observability
- scheduling
- retries, handoffs, escalation, verification, and completion

Core must remain independent of any particular business or infrastructure domain.

## 4. Core exclusions

AgentOS Core must not contain direct domain assumptions about:

- MikroTik or RouterOS
- Starlink
- Wi-Fi
- CCTV, ONVIF, or RTSP
- vouchers or hotspot billing
- EcoCash or other payment providers
- Telegram or WhatsApp-specific business logic
- Firebase-specific business rules
- any other single industry, vendor, or product domain

Domain-specific behavior belongs behind contracts, adapters, capabilities, or modules outside Core.

## 5. Dependency direction

The intended dependency direction is:

```text
Applications / Interfaces
          |
          v
       Gateway
          |
          v
     AgentOS Core
          |
          v
      Contracts
          ^
          |
       Adapters
          |
          v
   External Systems
```

Core may depend on stable abstractions/contracts. Core must not depend directly on concrete external technologies when an adapter boundary is appropriate.

A domain integration should look conceptually like:

```text
Agent
  |
  v
Tool / Capability
  |
  v
Contract / Interface
  ^
  |
Adapter
  |
v
External System
```

## 6. Domain modules

Domains are capabilities around AgentOS, not definitions of AgentOS itself.

Examples include:

```text
AgentOS Core
    |
    +-- Network capability
    +-- Media capability
    +-- Commerce capability
    +-- Support capability
    +-- Future capabilities
```

Adding or replacing a domain capability should not require rewriting AgentOS Core.

## 7. Execution lifecycle

The target execution lifecycle is:

```text
RECEIVE
  -> UNDERSTAND
  -> PLAN
  -> EXECUTE
  -> OBSERVE
  -> EVALUATE
  -> RETRY / HANDOFF / ESCALATE
  -> VERIFY
  -> COMPLETE
```

The audit must determine which parts of this lifecycle are actually implemented in `main` and which are only documented or intended.

## 8. Evidence-first rule

No architectural cleanup is performed merely because a file or subsystem looks old or unusual.

The process is:

```text
DISCOVER
  -> MEASURE
  -> UNDERSTAND
  -> DECIDE
  -> MODIFY
  -> TEST
  -> VERIFY
```

Every major KEEP, MERGE, REWRITE, or DELETE decision should be supported by repository evidence such as imports, call paths, runtime entrypoints, tests, configuration, or deployment references.

## 9. Phase 0 success criteria

The following are the architectural tests for later phases:

- One canonical AgentOS architecture exists in `main`.
- Core is domain-agnostic.
- Domain capabilities are isolated behind appropriate boundaries.
- Agents can use tools through stable contracts.
- Model providers can be replaced without rewriting Core.
- Persistence implementations can be replaced without rewriting Core.
- Execution can be observed, evaluated, retried, handed off, escalated, verified, and completed where required.
- Critical behavior is tested.
- CI validates `main`.
- Duplicate, orphaned, and dead systems are identified before removal.
- No unnecessary competing implementations remain after cleanup.

## 10. What Phase 0 does not decide

Phase 0 deliberately does **not** freeze:

- exact directory names
- exact programming language boundaries
- exact database technology
- exact model provider
- exact adapter implementations
- exact agent inventory
- exact deployment topology
- exact API shape

Those decisions must be derived from the Phase 1 repository measurement and subsequent audits.

## 11. Next phase

**Phase 1 — Repository X-ray**

Measure the actual `main` branch end-to-end before restructuring it:

1. repository and branch topology
2. files and directories
3. entrypoints
4. dependencies and imports
5. runtime paths
6. agents, tools, workflows, and models
7. persistence and infrastructure
8. tests and CI/CD
9. duplication and orphaned code
10. architecture drift against this baseline
