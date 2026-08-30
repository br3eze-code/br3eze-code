# AskEngine Upgrade Plan

## Objective

Upgrade `agents/ask-engine.js` into the central, observable orchestration boundary for AgentOS while preserving existing behavior and keeping CLI/PWA/channel adapters thin.

## Phase 1 — Audit

- Trace all AskEngine callers and provider invocations.
- Trace context, memory, skills, tools, agent delegation, permissions, retries, streaming and errors.
- Identify duplicated orchestration outside AskEngine.
- Record the existing contract before changing implementation.

## Phase 2 — Stable request/result contract

Introduce normalized request/result structures containing:

- requestId
- session/context
- principal/tenant
- message/attachments
- execution mode
- model policy
- response
- actions/tool calls/agent runs
- evidence
- usage
- errors
- audit metadata

Support synchronous, streaming, cancellation and resumable execution.

## Phase 3 — Canonical execution loop

Implement one lifecycle:

`UNDERSTAND → CONTEXT → PLAN → AUTHORIZE → DELEGATE → EXECUTE → OBSERVE → EVALUATE → REPLAN/RETRY/ESCALATE → VERIFY → COMPLETE`

AskEngine owns orchestration. Models reason; agents perform specialized work; skills describe capabilities; tools execute operations; policy determines authority; evidence records what happened.

## Phase 4 — Context and model abstraction

Create a ContextEngine that retrieves only relevant request, session, workspace, project, memory, policy, skill and tool context.

Create a provider-neutral ModelProvider boundary so Gemini, OpenAI, Anthropic and local models can be swapped without rewriting orchestration.

## Phase 5 — Planner, agents and skills

Use structured executable plans with step IDs, dependencies, capabilities, assigned agents and verification criteria.

Support parent/child agent runs without allowing sub-agents to silently create a second orchestration system.

Keep AGENT, SKILL, TOOL and MODEL as separate abstractions.

## Phase 6 — Unified tools and authority

Every tool should expose name, description, input schema, permissions, execute, verify and evidence behavior.

Consequential operations must pass an authority/policy check before execution. Model output never grants authority.

## Phase 7 — Verification and evidence

Do not mark consequential work complete merely because the model claims success. Execute explicit verification and produce evidence. Verification failure returns to replanning or escalation.

## Phase 8 — Event stream

Expose normalized events such as:

- request.started
- context.ready
- plan.created
- agent.started
- agent.completed
- tool.started
- tool.output
- tool.completed
- verification.started
- verification.completed
- message.delta
- request.completed
- request.failed

The CLI, PWA and other channels render these events instead of implementing orchestration themselves.

## Phase 9 — Terminal UI boundary

Build the Gemini/Claude-style terminal experience as a thin client of AskEngine. Keep input handling, ANSI/terminal rendering, markdown/code/diff rendering, spinners, status lines and approval prompts in the UI layer. Do not duplicate planning or tool execution there.

## Phase 10 — Persistence and recovery

Persist requests, plans, steps, agent runs, tool calls, events, approvals, evidence, verification and outcomes so execution can resume after process restarts.

## Phase 11 — Tests

Add unit/integration/architecture tests covering simple asks, multi-step work, tools, retries, delegation, permissions, approvals, cancellation, timeout, verification failure, model failure, resume and streaming.

## Acceptance criteria

1. AskEngine is the single orchestration boundary.
2. Existing channels do not duplicate orchestration.
3. Agents, skills, tools and models remain distinct.
4. Provider changes do not require orchestration rewrites.
5. Tool execution is authorized and observable.
6. Consequential work is verified.
7. Execution can be streamed and resumed.
8. Every execution has traceable evidence/audit metadata.
9. Existing behavior and tests remain intact.
10. A second audit confirms there is no parallel orchestration path.

## Implementation rule

Do not perform a wholesale rewrite. Patch incrementally around the existing AskEngine contracts, preserving compatible callers and removing duplication only after the replacement path is tested.
