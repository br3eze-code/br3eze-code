# Br3eze OS Level 2 — Managed Application Platform

## Product definition

Level 2 is an operating-system-like application platform that runs above supported host operating systems. It is not a bootable kernel. The portable contract must let applications and services use stable APIs while host adapters provide actual platform capabilities.

## Core subsystems

- Managed runtime: canonical AgentRuntime remains the only agent/task execution owner.
- Service supervisor: registered trusted services have explicit start/stop states, failure reporting, bounded registration, and lifecycle events.
- Permission model: host identity and explicit capability grants are required at IPC/platform boundaries; app manifests declare requested permissions but do not grant them automatically.
- IPC: in-process message bus supports tenant-scoped topics, JSON-compatible bounded payloads, per-topic authorization, correlation IDs, and audit hooks.
- Application lifecycle: declarative manifests identify app/version/entry service; start/stop delegates to the service supervisor.
- Local-first state: durable tenant/app-scoped JSON key/value storage with bounded values and atomic file replacement; sync/conflict policy remains a separate adapter.
- Package management: planned next stage; must verify package integrity, constrain install paths, validate manifests and support rollback before executing code.
- Workload isolation: planned; trusted in-process services are not a sandbox. Untrusted apps need process/container/OS sandbox boundaries.
- Local-first: existing local persistence is a starting point; a durable namespaced state store, offline queue, and deterministic sync/conflict policy remain to be implemented.
- Host abstraction: Node.js first; Cordova and other platform bridges must use explicit host APIs and permissions.

## Implemented foundation in this change

- Platform adapter registry and Node.js read-only diagnostics adapter.
- Runtime-owned service supervisor, IPC bus, application lifecycle manager, and local state store.
- Tests for lifecycle transitions, failure/permission behavior, tenant isolation, manifest validation, and app start/stop.

## Security invariants

- App manifest permissions are declarations only; host authorization must issue effective grants separately.
- Never expose arbitrary shell, unrestricted filesystem access, raw memory, or implicit hardware writes to apps.
- IPC topics are explicitly granted and tenant-scoped.
- A registry or in-process message bus is not a sandbox against malicious code.
- Remote IPC transports must authenticate both ends and preserve tenant/capability checks.
- Package install must verify digest/signature and reject path traversal before extraction or activation.

## Remaining Level 2 gates

1. Run focused tests and CI on the current branch.
2. Add concurrency/crash-recovery tests for local-first app state and define offline queue/sync/conflict semantics.
3. Implement package verification, safe install, version pinning and rollback.
4. Add process-isolated workload execution with least privilege; document platform differences.
5. Add lifecycle restart policy, health checks, dependency ordering, and graceful shutdown.
6. Build Cordova host adapter for permitted mobile APIs and test on real Android devices.
7. Architecture gate: OS/vendor imports stay outside shared core contracts.
