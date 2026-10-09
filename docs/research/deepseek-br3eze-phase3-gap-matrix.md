# DeepSeek Harness vs Br3eze AgentOS — Phase 3 Gap Matrix

Updated: 2026-10-08

This matrix is an extraction guide, not a merge plan. Br3eze remains the canonical product; DeepSeek Harness is used only as an architectural reference.

| Harness primitive | DeepSeek reference | Br3eze main | Gap | Phase 3 action |
|---|---|---|---|---|
| Scoped registration | `core/scope` | Multiple registries | No single scope primitive | Add canonical scope contract |
| Session event log | `core/session` | `SessionEventStore` now canonical | Persistence adapter + event vocabulary incomplete | Finish event contract, then durable adapter |
| Session projection | Derived messages from events | SessionManager stores JSONL history separately | Two sources of conversational truth | Make projections consume events |
| System prompt assembly | `core/system-prompt` | Runtime builds prompt inline | No canonical prompt compiler | Extract prompt compiler |
| Tool registry | `core/tools` | `core/tool-registry` + `runtime/registry` | Duplicate registries | Consolidate behind one capability boundary |
| Agent contract | `core/agent` | SpecialistRegistry, SpecialAgentRegistry, role profiles | No single live Agent handle contract | Add canonical Agent contract/registry |
| Agent loop | `core/agent-loop` | AgentRuntime + runtime Runtime + older engines | Multiple loop implementations | Select one canonical loop |
| Default model | `agent-default-model` | ProviderManager/adapters | Broad provider support, weaker selection contract | Define model-selection port |
| Context | Explicit runtime context | execution-context + bot.ai + ContextEngine | ContextEngine is new wrapper; consumers remain split | Route consumers, then retire duplicates |
| Tool presentation | Per-agent presentation selector | Tool manifest / LLM schema | No agent-scoped presentation layer | Add later after registry consolidation |
| Compaction | Session compaction/projection | SessionManager.compact | Exists but rewrites history directly | Move compaction to event projection |
| Cancellation/concurrency | Agent loop scheduler | maxIterations and sequential tool execution | Limited lifecycle scheduler | Add explicit step lifecycle later |
| Handoff | Agent APIs/events | SpecialistRuntime / handoff / A2A | Strong domain implementation, fragmented core boundary | Normalize handoff event/contract |
| Evaluation/replay | Replay-oriented tests/events | Tests + execution records + telemetry | No unified trajectory evaluator | Add evaluation harness after loop |
| Bundles/composition | `packages/bundle` | Plugins/adapters/services | Composition exists but is not one canonical bundle contract | Define bundle manifest later |

## Phase 3 extraction order

1. Canonical Context boundary
2. Canonical Agent contract + registry
3. Canonical capability/tool registry
4. Canonical Agent Loop state machine
5. Prompt compiler
6. Event-backed session projection
7. Durable session-event adapter
8. Replay/evaluation harness
9. Bundle/composition contract

## Guardrails

- Do not import DeepSeek product code wholesale.
- Do not move Firebase, Supabase, RouterOS, billing, Wi-Fi, commerce, or logistics into Core.
- Do not delete compatibility shims until call sites are mapped.
- Do not claim a primitive is complete until its tests exercise the canonical path.
