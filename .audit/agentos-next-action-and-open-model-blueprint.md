# AgentOS Next-Action Prediction and Open-Model Blueprint

## Executive answer

A bot can predict a user’s **next likely critical path** without claiming to read the user’s mind. It should treat prediction as a bounded ranking problem over observable workflow evidence: the active WBS, unfinished dependencies, explicit user goal, authorized scope, recent accepted or rejected suggestions, tool results, deadlines, device/site health, and the user’s current channel. It should generate a small set of candidate actions, explain the evidence, expose uncertainty, and ask for clarification whenever intent or execution prerequisites are ambiguous.

The safe production pattern is **predict, prepare, propose, approve, execute, verify**. Prediction creates no side effect. Preparation may load read-only context, refresh telemetry, compute a draft, or render an action preview. Proposal informs the user. Approval is mandatory for payments, access changes, network disconnections, surveillance operations, account suspension, or other irreversible actions. Execution occurs only through the existing capability policy, canonical execution context, WBS, and audit pipeline.

## What AgentOS already has

AgentOS already contains the main state primitives needed for this design. `src/core/action-wbs.js` models ordered work, dependencies, progress, and action-specific templates. `src/core/execution-context.js` supplies canonical user, channel, tenant, site, capability, device, location-permission, and WBS state. `src/core/user-task-service.js` provides scoped task ownership and task access checks. `src/core/ask-engine.js` already has tiered routing, skill discovery, tool declarations, approval checks, and state broadcasting.

The missing layer is a narrowly scoped `next-action-planner` that consumes these signals and emits a validated proposal rather than directly invoking tools. The planner should be separate from `AskEngine` so that proactive prediction cannot accidentally inherit a mutation path.

## Proposed event flow

```text
user/channel/device event
        |
        v
canonical execution context + WBS + recent task history
        |
        v
candidate extraction (deterministic rules)
        |
        v
small structured model ranker, only when needed
        |
        v
policy and risk validator
        |
        +--> low-risk preparation: read-only state refresh / draft / preview
        |
        +--> user proposal: buttons such as Continue, Clarify, Snooze, Dismiss
        |
        +--> approval gate for side effects
        |
        v
approved executor -> WBS transition -> audit event -> user update
```

The first stage should be deterministic. For example, if a WBS has a `confirm` step pending and the action is destructive, the next action is `request_confirmation`, not an LLM-generated router command. If a task has failed prerequisites, the next action is `resolve_blocker`. A model should rank among valid candidates only; it should not invent a new action ID.

## Candidate action contract

Use a strict schema similar to the following:

```json
{
  "taskId": "task_123",
  "candidates": [
    {
      "actionId": "task.request_clarification",
      "label": "Choose the target site",
      "reasonCodes": ["missing_site_scope"],
      "evidence": ["wbs:scope.pending", "context:siteId=null"],
      "confidence": 0.94,
      "urgency": "normal",
      "risk": "low",
      "estimatedEffortSeconds": 30,
      "requiresApproval": false,
      "requiredCapabilities": [],
      "wbsStepId": "assist.task:scope"
    }
  ],
  "speakNow": false,
  "notificationReason": "wait_for_user_input",
  "expiresAt": "2026-08-16T12:00:00Z"
}
```

The validator must reject unknown action IDs, confidence outside `[0,1]`, WBS step IDs not present in the task, capability requirements not granted by canonical context, and any side-effecting candidate that lacks an approval requirement. Keep evidence as codes and bounded summaries; do not expose hidden chain-of-thought.

## Critical-path ranking features

Rank candidates using the following observable features: WBS dependency readiness; action status; explicit user wording; unresolved clarification slots; tool-result failures; task age and deadline; site/device health; prior acceptance, dismissal, or snooze behavior; current channel affordances; role and authorized capabilities; location permission; and whether the next step is reversible.

Do not use protected or sensitive attributes as predictive features. Do not infer location from IP, phone number, language, or social graph. Do not infer psychological state. Do not treat a model’s narrative confidence as authorization. Authorization remains a deterministic backend decision.

A practical score is:

```text
score = 0.30 * dependency_readiness
      + 0.20 * explicit_intent_match
      + 0.15 * blocker_relevance
      + 0.10 * deadline_urgency
      + 0.10 * prior_acceptance
      + 0.05 * channel_fit
      - 0.20 * ambiguity
      - 0.25 * side_effect_risk
```

The coefficients should be learned or calibrated from opt-in telemetry later; begin with transparent rules and log each contribution for evaluation.

## Ask-before-Plan behavior

The Ask-before-Plan paper defines proactive planning as predicting when clarification is needed from conversation and environment interaction, using tools to collect valid information, and generating a plan. It reports that planning can fail without clarification when the user’s intention is underspecified. AgentOS should therefore use a clarification gate before ranking an action when required information is missing or when multiple sites, users, products, or payment methods match.

The bot should ask at most one high-value clarification question at a time. A channel-specific UI can present choices, but the backend must still validate the selected identifier against tenant and site scope. The question should state why the information is needed and what will happen next.

Source: [Ask-before-Plan: Proactive Language Agents for Real-World Planning](https://arxiv.org/html/2406.12639v1).

## State preparation and proactive notification policy

Separate three states: `predicted`, `prepared`, and `approved`. A prediction may be stored as a short-lived proposal. Preparation may read telemetry, load a task, calculate a payment preview, or create a draft. Approval is a user decision with a timestamp, actor, action ID, scope, and expiry. The executor must re-check the current context at execution time because the user’s role, site selection, device state, or permission may have changed.

Use a notification budget per user and channel. A safe default is no more than one proactive message per active task per cooldown window, with quiet hours and a user-level opt-out. Use `speakNow=false` when the candidate is low confidence, when the user is in an unrelated conversation, or when no meaningful progress can be made without approval. Every proactive notification should offer `Continue`, `Clarify`, `Snooze`, and `Dismiss` actions. Dismissals and overrides should lower future notification frequency rather than punish the user.

## Gamified experience without manipulation

Gamification should visualize work, not manipulate attention. Use WBS progress, milestone badges for completed scopes, streaks for voluntary task continuity, levels for verified operational competence, and a progress bar showing the next safe step. Do not award points for risky actions, unnecessary tool calls, payment volume, or surveillance activity. Do not hide the Dismiss or Disable Suggestions options.

A good Telegram or WhatsApp interaction is: “You are at 60%: site scope is confirmed, but the router health check is pending. Next safe step: run a read-only health check. [Run check] [Choose another step] [Snooze].” The button must map to a known action ID and pass through the same policy and WBS executor as a typed command.

## Model-routing matrix

| Model family | Best role in AgentOS | Strengths | Guardrails and caveats |
|---|---|---|---|
| Qwen family | Local or hosted structured ranker, coding/tool planner, UI/browser helper | Strong open ecosystem, tool/function calling documentation, broad deployment options | Validate tool schema and arguments; do not assume every checkpoint has identical tool-call formatting. |
| Kimi K2 | High-complexity research, coding, and multi-step planning fallback | Open agentic MoE model; paper reports agentic and coding strength and training with agentic data and RL | Large model cost and latency; benchmark claims do not remove authorization or prompt-injection risk. |
| Baidu ERNIE 4.5 family | Multimodal or regional provider fallback where supported | Open releases and multimodal variants; tool-call-capable checkpoints are available in the ecosystem | Confirm license, hosting, language, tool schema, and data residency for the chosen checkpoint. |
| DeepSeek family | Reasoning-heavy offline or low-cost planning and coding | Official tool-call documentation and open model availability | Tool calling is model/provider dependent; force structured output and verify every call before execution. |
| Llama family | Self-hosted general ranker, summarizer, and policy-explanation model | Mature open-weight ecosystem and broad inference support | Tool support depends on checkpoint, chat template, and serving stack; test exact model version. |
| Mistral family | Low-latency local classification, extraction, and tool routing | Efficient deployment options and tool-compatible serving patterns | Verify function-call formatting and context window for each deployment. |
| Current built-in catalog | Managed high-quality escalation | Access to current GPT, Claude, and Gemini families through the runtime catalog | Query the live catalog; do not hardcode model IDs, pricing, or thinking parameters. |

Source links: [Qwen function calling](https://qwen.readthedocs.io/en/latest/framework/function_call.html), [Qwen3-Coder](https://qwenlm.github.io/blog/qwen3-coder/), [Kimi K2](https://arxiv.org/abs/2507.20534), [Kimi K2.5](https://arxiv.org/abs/2602.02276), [DeepSeek tool calls](https://api-docs.deepseek.com/guides/tool_calls), [Meta Llama 4](https://ai.meta.com/blog/llama-4-multimodal-intelligence/), and [vLLM tool calling](https://docs.vllm.ai/en/v0.25.1/features/tool_calling/).

## Recommended two-tier architecture

For every task event, run a cheap deterministic ranker first. It should handle obvious WBS transitions, missing scope, failed prerequisites, and pending confirmations without a model. If multiple candidates remain or the user’s wording is ambiguous, call a small structured-output model with only the redacted canonical context and a fixed candidate list.

Escalate to a stronger model only for deep research, cross-source synthesis, multi-step code planning, or visually complex workflows. The strong model may propose a ranked candidate list and clarification question, but a deterministic validator decides whether the candidate is legal. This routing minimizes cost and reduces the attack surface.

For self-hosted open models, expose an OpenAI-compatible adapter with a provider configuration containing endpoint, model ID, timeout, max tokens, JSON-schema support, tool-call support, and data-residency label. Keep provider credentials server-side. Add circuit breakers, timeouts, fallback order, and per-tenant usage metering.

## Web-MCP agent boundary

A future web-MCP integration should be read-only by default and isolated from core credentials. Use OAuth 2.1/PKCE or the MCP provider’s supported authorization, validate issuer and audience, never forward a user token to an unrelated tool, restrict outbound URLs to an allowlist, block private-network SSRF, limit redirects, redact secrets from page content, and require explicit approval for form submission, purchases, account changes, or posting.

Represent web actions as ordinary AgentOS skills with manifests, capability requirements, WBS templates, and audit events. A web tool should return structured observations; the planner decides the next candidate; the executor performs only the approved action. Treat page instructions and retrieved text as untrusted data, not as system instructions.

## Evaluation plan

Measure top-1 and top-3 next-action accuracy against human-labeled task trajectories; calibration error for confidence; clarification precision and recall; unauthorized-action rate; tool-call argument validity; false-proactive-notification rate; notification acceptance, dismissal, and snooze rates; time-to-completion; WBS stall rate; cost per completed task; and cross-channel consistency.

Safety gates should dominate engagement metrics. A release should fail if unauthorized-action rate is nonzero, if a side-effecting action can execute without approval, if tenant or site scope is lost, if location permission is bypassed, or if an untrusted web page can inject executable instructions. Use shadow mode first: log predictions without messaging users, then enable suggestions for internal operators, then expand by tenant with opt-out.

## Concrete implementation sequence

First, add `src/core/next-action-planner.js` with deterministic candidate generation, a fixed candidate registry, confidence calibration, and a `predictNextAction(context, task)` API. Second, add `src/core/proactive-policy.js` for notification budget, cooldown, quiet hours, opt-out, and `speakNow`. Third, add an `assist.next_action` WBS template and a proposal record with expiry, approval, and evidence codes. Fourth, connect proposals to the existing `channel-action-manifest.js` and `channel-ui-policy.js` so Telegram, WhatsApp, web, desktop, and Cordova render the same action IDs with channel-specific presentation. Fifth, add an LLM adapter that receives only the candidate list and redacted state, validates JSON schema, and never receives direct mutation authority. Sixth, run shadow-mode evaluation and use accepted, dismissed, snoozed, and corrected proposals as labeled feedback.

## Bottom line

The strongest AgentOS design is not an autonomous bot that guesses what a person will do. It is a **transparent workflow co-pilot** that notices the next dependency in a user-approved task, prepares safe read-only state, proposes one or two explainable next steps, asks for missing information, and requires explicit approval for side effects. Qwen, Kimi, Baidu ERNIE, DeepSeek, Llama, Mistral, and managed models can all serve different routing tiers, but none should bypass canonical context, WBS, capability policy, approval gates, tenant/site isolation, or audit logging.

## References

1. Zhang et al., “Ask-before-Plan: Proactive Language Agents for Real-World Planning,” https://arxiv.org/html/2406.12639v1
2. Bai et al., “Kimi K2: Open Agentic Intelligence,” https://arxiv.org/abs/2507.20534
3. Kimi Team, “Kimi K2.5,” https://arxiv.org/abs/2602.02276
4. Qwen documentation, “Function Calling,” https://qwen.readthedocs.io/en/latest/framework/function_call.html
5. Qwen Team, “Qwen3-Coder,” https://qwenlm.github.io/blog/qwen3-coder/
6. DeepSeek documentation, “Tool Calls,” https://api-docs.deepseek.com/guides/tool_calls
7. Meta AI, “The Llama 4 Herd,” https://ai.meta.com/blog/llama-4-multimodal-intelligence/
8. vLLM documentation, “Tool Calling,” https://docs.vllm.ai/en/v0.25.1/features/tool_calling/
9. Shinn et al., “Reflexion,” https://openreview.net/forum?id=vAElhFcKW6
10. Wang et al., “Voyager,” https://openreview.net/forum?id=ehfRiF0R3a
11. “Proactive Conversational Agents with Inner Thoughts,” https://arxiv.org/html/2501.00383v2
12. “Anticipate and Learn,” https://arxiv.org/abs/2605.25971
13. “Toward Personalized LLM-Powered Agents,” https://arxiv.org/abs/2602.22680
14. “Agentic AI: Architectures, Taxonomies, and Evaluation,” https://arxiv.org/abs/2601.12560
