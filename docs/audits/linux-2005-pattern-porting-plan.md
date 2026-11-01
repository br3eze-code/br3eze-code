> Historical audit note ported from the Level 3 foundation branch. Its baseline SHA and status reflect the original review date, not current-main verification. Re-run the named checks before using its scores or implementation claims as current facts.

# Linux 2.6-era patterns: AgentOS port plan

Date: 2026-10-26
Baseline: \`main\` at \`2e69f25e1be2f4cb2beeb51820ac4e608153de20\`
Working branch: \`refactor/linux-single-runtime-boundaries\`

## Goal and boundary

Borrow engineering patterns from Linux 2.6-era development (including the 2005 period); do not copy kernel code into Node.js and do not claim the Node.js process is a hardware kernel. AgentOS can become an operating-system-like application platform; a bootable general-purpose OS additionally needs a real kernel or a Linux-based distribution, drivers, boot, memory protection, and hardware support.

## Source facts confirmed on the baseline

- \`package.json\` declares \`src/core/agentRuntime.js\` as the package main entry.
- \`getAgentRuntime()\` returns one module-level runtime singleton and applies supported reconfiguration to that object.
- The gateway sets \`global.agentRuntime\` and legacy \`global.askEngine\` to the same runtime object. It also gives that object to the scheduled task runner and gateway compatibility field.
- \`src/core/taskScheduler.js\` still supports both a kernel dispatch interface and an engine \`.run(prompt)\` interface. This is a compatibility seam, not yet a uniform task contract.
- \`src/ai/coordinator.js\` directly constructs a Gemini client, a model gateway, a skill registry, and a MikroTik manager. It owns its own \`processQuery\` / \`executeTool\` path.
- \`src/core/ask-engine.js\` has a separate tiered ReAct loop and provider-specific function declarations. Repository documentation identifies it as a distinct path from \`AICoordinator\`.
- \`src/ai/universal-coordinator.js\` is another Gemini-coupled coordinator candidate.
- \`src/core/agent-runtime/\` contains useful policy, supervisor, checkpoint, tracing, usage, and execution-graph primitives. Their existence alone does not prove the main runtime uses all of them.
- The source tree includes historical \`AgentKernel\`, \`AgentOS\`, and harness abstractions. Do not delete them based only on class names or documentation.

## Linux-era pattern mapping

| Linux engineering pattern | AgentOS port | Verification |
| --- | --- | --- |
| One subsystem owns each responsibility | One canonical runtime; registries own identity; stores own persistence; adapters own provider APIs | Architecture tests reject accidental second execution owners |
| Scheduler responsiveness and fairness | Bounded queues, priorities, deadlines, cancellation, concurrency caps | Stress tests measure queue wait, fairness, and deadline compliance |
| Preemption and safe interruption | Cooperative cancellation and abort signals between model/tool steps; no promise of hard real-time preemption in Node.js | Cancellation tests prove tools stop at supported boundaries |
| Device model and stable interfaces | Capability ports with provider/router/storage adapters | Contract tests run against fake adapters and at least one real adapter |
| Fine-grained resource ownership | Per-task/tenant budgets and per-provider rate limits instead of one global unbounded bottleneck | Concurrent tests prove tenant/resource caps are respected |
| Diagnostics and traceability | Correlated task/span IDs, structured events, usage/cost records, replayable outcomes | Trace completeness tests and failure-injection tests |
| Patch review and regression discipline | Small file-by-file ports, before/after benchmark, no wholesale branch merges | CI evidence, diff review, and reversible migrations |

Do not reproduce the 2005 O(1) scheduler algorithm just because it was historically important; the lasting pattern is bounded scheduling cost, fairness, and measurable responsiveness. Linux's scheduler evolved after that era.

## Migration sequence

### Phase 0 — Establish evidence (this PR)

1. Guard the known gateway singleton composition.
2. Add a report-first static audit to list engine constructors and provider imports inside core.
3. Record each finding as live, adapter, test-only, deprecated, or unresolved. Static matches are leads, not call-graph proof.

### Phase 1 — Standardize execution contract

1. Define a domain-neutral request contract accepted by \`AgentRuntime.execute(frame)\`.
2. Adapt scheduler, HTTP, CLI, Telegram/WhatsApp, and plugin entry points to that contract.
3. Keep channel-specific parsing, UI formatting, and tool schemas at the edge.
4. Preserve existing tool names, arguments, permissions, and response formats with compatibility tests.

### Phase 2 — Absorb useful legacy behavior

1. Extract reusable tool schemas and domain skill discovery into registries/adapters.
2. Move provider-specific model calls behind the existing model port.
3. Route legacy coordinator tool invocations through runtime-owned authorization and execution; never let a legacy loop bypass policy.
4. Remove a legacy loop only after caller tracing, behavioral tests, and usage telemetry show it is no longer needed.

### Phase 3 — Benchmark and retire

For each migration, record baseline and candidate results for correctness, latency, memory, provider calls, task duplication, permission enforcement, and failure recovery. Keep the old path only for the migration window, with an explicit removal condition. Do not call the platform production-ready based on architecture scores alone.

## Validation status

Source inspection and a regression test have been authored. This GitHub workflow did not run the test suite in a checked-out Node.js environment. Run:

- \`npm run audit:runtime-boundaries\`
- \`npm run check:architecture\`
- \`npm run check:ci-quality\`
- \`npm test -- --runInBand --coverage=false\`

The strict audit is intentionally opt-in at this stage because the source tree contains unresolved legacy constructors. First establish and disposition the baseline; only then make proven rules blocking.
