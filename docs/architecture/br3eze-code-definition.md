# Br3eze Code: project definition

## One-sentence definition

**Br3eze Code is a domain-agnostic, provider-neutral runtime and application platform for composing, executing, supervising, and verifying capabilities across software domains and host environments.**

The platform is intended to support hosted or local models, external providers, tools, skills, plugins, workflows, persistence adapters, and eventually managed applications on a Linux-based Br3eze OS distribution.

## Names and responsibilities

| Name | Responsibility | Does not mean |
|---|---|---|
| **Br3eze Code** | The overall repository, contracts, runtime, extensions, tooling, tests, and delivery process | A finished standalone operating system today |
| **AgentOS** | The canonical agent harness and execution flow for plan/act/observe/evaluate/verify | A second runtime competing with AgentRuntime |
| **AgentRuntime** | The single authoritative agent orchestration and capability execution boundary | The operating-system kernel or a hardware driver |
| **Level 2 platform** | Managed application concepts: manifests, provider SPIs, permissions, IPC, lifecycle, and workload runners | A security sandbox unless host isolation actually enforces it |
| **Br3eze OS Level 3** | A Linux-based distribution with kernel, bootable image, userland, services, diagnostics, and later installation/recovery | A custom kernel written from scratch |
| **Providers and adapters** | Translate external model, storage, network, hardware, identity, messaging, and other services into stable contracts | Core orchestration logic |
| **Domains** | Optional packages such as networking/Wi-Fi, coding, commerce, logistics, or documents | Assumptions embedded into the generic runtime |

## Architectural rules

1. **One agent execution owner.** All agent requests must converge on AgentRuntime. Platform service supervision is separate infrastructure, not another model/agent loop.
2. **Domain-neutral core.** Core contracts must not require MikroTik, Starlink, Firebase, Supabase, a payment vendor, a model vendor, or any single business domain.
3. **Provider-neutral contracts.** Vendor-specific APIs live behind explicit adapters and are selected through documented configuration.
4. **Default-deny permissions.** Capability requests are checked at the host execution boundary. Prompt instructions and registry metadata alone are not security controls.
5. **Isolation claims require enforcement.** In-process plugins/providers are trusted code unless constrained by an actual process, container, VM, or equivalent host boundary.
6. **Lifecycle and failure are explicit.** Startup, readiness, shutdown, cancellation, timeouts, crash recovery, and health reporting need testable contracts.
7. **Local-first where practical.** The platform should support local state and operation without making cloud vendors part of its core semantics.
8. **Evidence-based releases.** A passing syntax check is not a successful build; a generated ISO is not a verified boot; and a successful boot is not proof of production security.
9. **Port patterns, not branches wholesale.** Compare alternative branches file by file, retain demonstrably better behavior, add regression tests, and remove duplicates only after callers migrate.
10. **No premature merge claims.** PRs are integration proposals until prerequisites, required checks, review, and merge are confirmed.

## Intended layered architecture

```text
Hardware / VM / cloud host
          |
Linux kernel + Debian userland (Br3eze OS, Level 3)
          |
Host adapters + OS service supervision
          |
Managed platform (Level 2: manifests, providers, IPC, permissions)
          |
AgentRuntime (single agent execution owner)
          |
Tools / skills / plugins / workflows / domain packages
          |
External model, storage, network, identity and messaging adapters
```

The diagram describes the intended direction, not a claim that every layer is already fully implemented or integrated.

## Current maturity language

Use these labels in documentation and release notes:

- **Implemented:** code exists in the repository.
- **Unit-tested:** focused tests pass on the current commit.
- **Built:** the relevant artifact was successfully produced by CI.
- **Boot-verified:** the exact image booted and passed smoke tests in a VM or supported device.
- **Release-ready:** boot/recovery, security, provenance, update/rollback, hardware support, and release checks have been reviewed.

Do not describe Br3eze OS as production-ready until those release gates are evidenced. The initial Level 3 path uses Debian Live and upstream Linux components to establish a practical bootable base before adding installation, persistence, signed updates, rollback, and stronger workload isolation.

## Definition of done for the platform

- A single documented runtime contract owns agent orchestration.
- Tests prove provider selection, permission enforcement, cancellation, and workload lifecycle.
- Domain adapters can be removed or replaced without rewriting the generic core.
- Host-specific services have explicit lifecycle and least-privilege identities.
- CI validates the code and builds real deliverables where practical.
- OS images are boot-tested, checksummed, and later signed; update and recovery behavior is documented and tested.
- Known gaps are visible, and no roadmap item is presented as an implemented feature.
