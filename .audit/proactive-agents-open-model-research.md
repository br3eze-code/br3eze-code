# Proactive Agents and Open-Model Research Notes

## Open-model sources

- Qwen function calling documentation: https://qwen.readthedocs.io/en/latest/framework/function_call.html
  - Qwen-Agent is an agent framework supporting function calling; use tool schemas and explicit tool execution rather than unconstrained text actions.
- Qwen3-Coder official announcement: https://qwenlm.github.io/blog/qwen3-coder/
  - Positions Qwen3-Coder as an agentic coding, browser-use, and tool-use model.
- Kimi K2 paper: https://arxiv.org/abs/2507.20534
  - Describes Kimi K2 as an open agentic MoE model trained around tool-use trajectories and agent tasks.
- Kimi K2.5 paper: https://arxiv.org/abs/2602.02276
  - Describes visual agentic intelligence and dynamic parallel agent swarms; this is relevant to parallel research and UI/device workflows but requires strong task and permission boundaries.
- Current built-in catalog guidance: `/home/ubuntu/skills/builtin-llm-models/SKILL.md`
  - The current Manus proxy catalog lists GPT-5 family, Claude 4.x, and Gemini 3.x; the live catalog must be queried at runtime rather than hardcoding model IDs. Structured JSON output and tool calling are supported, but provider-specific thinking/max-token parameters differ.

## Proactive-agent and next-action sources

- Ask-before-Plan: https://arxiv.org/html/2406.12639v1
  - Introduces proactive agent planning as predicting when clarification is needed based on user context and plan state. AgentOS should ask before acting when uncertainty or side-effect risk is high.
- Proactive Language Agents for Real-World Planning: https://aclanthology.org/2024.findings-emnlp.636.pdf
  - Treats proactive planning as a distinct capability rather than simply generating the next response.
- Learning Next Action Predictors from Human-Computer Interaction: https://arxiv.org/html/2603.05923v1
  - Frames next-action prediction as reasoning over interaction sequences plus relevant user history. AgentOS should predict a small ranked set of candidate actions with evidence and confidence, not assert certainty.
- Proactive Conversational Agents with Inner Thoughts: https://arxiv.org/html/2501.00383v2
  - Proactive agents need turn-taking and a policy for deciding whether to speak at all. AgentOS should use a notification budget and interruption policy.
- Anticipate and Learn: https://arxiv.org/abs/2605.25971
  - Studies idle-time computation for proactive assistance and highlights cost-efficiency, memory support, and explicit consent for proactive memory use.
- Toward Personalized LLM-Powered Agents: https://arxiv.org/abs/2602.22680
  - Frames personalization as a pipeline involving user modeling, intent inference, interaction history, and feedback from prediction errors.
- Agentic AI architectures survey: https://arxiv.org/abs/2601.12560
  - Surveys planning, memory, tool use, multi-agent coordination, and evaluation concerns.
- ReAct overview: https://www.ibm.com/think/topics/react-agent
  - ReAct combines reasoning and acting through external tools; in production this must be wrapped with policy checks and tool-result validation.
- Voyager: https://openreview.net/forum?id=ehfRiF0R3a
  - Uses curriculum learning, an executable skill library, and iterative feedback; the transferable pattern is explicit skill/state progression rather than unrestricted autonomy.

## Design conclusions for AgentOS

1. Predict the next critical path from WBS state, unfinished dependencies, recent user intent, explicit goals, role/capabilities, deadlines, device/site state, and prior accepted/rejected suggestions. Do not infer protected traits or claim to read a user's mind.
2. Produce `candidateActions[]` with action ID, rationale, prerequisites, confidence, urgency, risk, estimated effort, and required approval. Only the top low-risk candidate may be prepared automatically; side-effecting actions require confirmation.
3. Use a two-stage model path: cheap structured classifier/ranker for every event, then stronger reasoning model only for ambiguous or high-impact cases. Validate JSON schema, confidence range, capability requirements, and WBS references programmatically.
4. Separate prepare from execute: preload context, fetch read-only telemetry, render a preview, and create a draft task; never mutate payments, network, access, or surveillance state without explicit authorization and approval.
5. Gamification should expose progress, streaks, milestones, and “next best step” choices, not manipulate users through hidden urgency or deceptive rewards. Let the user disable proactive prompts and set notification frequency.
6. Evaluate with top-k next-action accuracy, calibration, clarification precision, unauthorized-action rate, interruption rate, acceptance rate, time-to-completion, and user override rate. Safety metrics must dominate raw engagement.

## Primary-source extracts

The Ask-before-Plan paper defines proactive agent planning as predicting when clarification is needed from the conversation and agent-environment interaction, invoking tools to collect valid information, and generating a plan. It reports that planning without clarification can fail when the user’s intention is under-specified, and that incorrectly predicted tool usage can reduce the effectiveness of an integrated clarification-and-planning framework. Source: https://arxiv.org/html/2406.12639v1.

The Kimi K2 paper describes a 32B-active / 1T-total MoE model trained with large-scale agentic data synthesis and joint reinforcement learning through real and synthetic environments. It reports strong agentic benchmark results, but those are model-level benchmark claims, not proof that an unguarded deployment is safe for AgentOS’s tenant, payment, network, or surveillance actions. Source: https://arxiv.org/abs/2507.20534.
