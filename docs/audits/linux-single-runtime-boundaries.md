# Linux-inspired single-runtime boundary audit

Date: 2026-10-26
Baseline: `main` at `87441b79e6978e22b4d940e09eafed526ece8ab1`

## Scope

Apply Linux-style subsystem ownership and patch discipline to AgentOS without importing Linux implementation code. This pass audits the live gateway composition path and adds a regression contract before any runtime implementation is removed.

## Confirmed facts

- `package.json` points the package entry at `src/core/agentRuntime.js`.
- `src/cli/commands/gateway.js` composes the provider model port at the host boundary and calls `getAgentRuntime(...)`.
- The gateway assigns the returned object to both `global.agentRuntime` and the legacy `global.askEngine` alias.
- The scheduled task runner receives the same local `runtime` instance as its engine.
- The gateway object receives that same instance as both `gateway.runtime` and `gateway.askEngine`.
- `getAgentRuntime` is a singleton accessor that reconfigures the existing runtime rather than creating a second one when called again.
- Separate runtime-like abstractions and older AI coordination code still exist in the repository. Names alone do not prove they are live, dead, or safe to delete.

## Linux principles applied

1. **One owner:** runtime construction remains in the composition boundary; consumers receive the runtime.
2. **Subsystem boundaries:** provider selection remains in an adapter; the core receives a model port.
3. **Compatibility without a second engine:** the `askEngine` alias is preserved for existing callers but references the canonical runtime.
4. **Patch discipline:** add a regression test for the actual gateway wiring before attempting destructive consolidation.
5. **Evidence before deletion:** do not remove `AICoordinator`, `AgentOS`, `AgentHarness`, or other legacy-looking files until production callers and behavior have been traced.

## Remaining blockers before claiming a single runtime across the whole product

- Trace all channel, HTTP/API, CLI, workflow, plugin, scheduler, and subagent execution entry points.
- Determine whether `src/ai/coordinator.js` is still invoked in production and whether its independent model/tool loop can be migrated through `AgentRuntime.execute` without changing network-domain behavior.
- Identify direct constructors of runtime-like classes and distinguish intentional embedded instances from competing production orchestration.
- Add tests for each migrated entry point, then remove obsolete paths only after references and regressions are addressed.

## Validation status

This is a source-level audit plus a regression test. It is **not** a claim that the full test suite, build, lint, or production deployment has passed. Those checks must run in CI or a checked-out Node.js 22 environment before merge.

## Scoring rubric for follow-up audits

Score architecture out of 100 using explicit evidence: runtime ownership (25), live entry-point convergence (25), domain/provider isolation (20), compatibility and migration safety (15), and regression/CI evidence (15). Do not inflate the score based on README claims or the presence of architecture files alone.
