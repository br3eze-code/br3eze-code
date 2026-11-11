# Br3eze AgentOS Specialist Skills

This is the portable skill source catalogue. Skills are standalone `SKILL.md` packages with YAML frontmatter and an embedded cross-agent operating contract. They are designed to be consumed by compatible agents and IDEs without making Claude Code or GitHub a runtime requirement.

## Release and cross-agent specialists

| Skill | Responsibility |
|---|---|
| [Cordova](cordova/SKILL.md) | Staged WBS delivery from discovery/design through tests, Vercel, Android release and launch verification |
| [Android Release](agentos-android-release/SKILL.md) | Android release candidate, signing readiness, Play tracks, approval and publication evidence |
| [Web Design](agentos-web-design/SKILL.md) | Accessible responsive design, low-dependency implementation and browser QA |
| [Live Project Observer](agentos-live-project-observer/SKILL.md) | Read-only evidence-based status across connected agents, CI, GitHub, local bridge and deployments |
| [Multi-Agent IDE](agentos-multi-agent-ide/SKILL.md) | Portable skills and tool contracts across IDEs, with one execution owner |
| [Vercel Deploy](agentos-vercel-deploy/SKILL.md) | `vercel.json`, minimal dependencies, build/output/route checks and approved rollout |

## Project, engineering and governance

| Skill | Responsibility |
|---|---|
| [AgentOS Accountant](agentos-accountant/SKILL.md) | Cost, estimates and financial evidence |
| [AgentOS Designer](agentos-designer/SKILL.md) | Experience design and handoff |
| [AgentOS Draftsman](agentos-draftsman/SKILL.md) | Controlled technical/project documents |
| [AgentOS Editor](agentos-editor/SKILL.md) | Editing and quality of written artifacts |
| [AgentOS Engineer](agentos-engineer/SKILL.md) | Implementation and technical validation |
| [AgentOS Expeditor](agentos-expeditor/SKILL.md) | Dependencies, blockers and delivery follow-up |
| [AgentOS Planner](agentos-planner/SKILL.md) | WBS, schedule and dependencies |
| [AgentOS Procurement](agentos-procurement/SKILL.md) | Sourcing and supplier decisions |
| [AgentOS Project Manager](agentos-project-manager/SKILL.md) | Baseline, owners, WBS, risks, approvals and closeout |
| [AgentOS QA](agentos-qa/SKILL.md) | Test strategy and acceptance evidence |
| [Role Skill Factory](agentos-role-skill-factory/SKILL.md) | Specialist skill creation and validation |
| [AgentOS Secretary](agentos-secretary/SKILL.md) | Records, communications and decision trails |
| [Security Remediation](agentos-security-remediation/SKILL.md) | Risk triage and secure remediation |
| [Specialist Swarm](agentos-specialist-swarm/SKILL.md) | Controlled specialist delegation and handoffs |

## Domain specialists

- [Billing and Payments](billing-payments-specialist/SKILL.md)
- [Br3eze Service Agent](br3eze-service-agent/SKILL.md)
- [Calendar](calendar/SKILL.md)
- [Catalog](catalog-specialist/SKILL.md)
- [Coding](coding/SKILL.md)
- [Design](design/SKILL.md)
- [Designer](designer/SKILL.md)
- [Email](email/SKILL.md)
- [Finance](finance/SKILL.md)
- [Fulfillment and Expeditor](fulfillment-expeditor-specialist/SKILL.md)
- [General](general/SKILL.md)
- [Inventory](inventory-specialist/SKILL.md)
- [Loop](loop/SKILL.md)
- [MCPorter](mcporter/SKILL.md)
- [Mesh](mesh/SKILL.md)
- [MikroTik](mikrotik/SKILL.md)
- [NanoPDF](nanopdf/SKILL.md)
- [Orders and Checkout](orders-checkout-specialist/SKILL.md)
- [Pricing and Promotions](pricing-promotions-specialist/SKILL.md)
- [Procurement](procurement-specialist/SKILL.md)
- [Product](product-specialist/SKILL.md)
- [Project Manager](project-manager/SKILL.md)
- [Project CPM/EVM](project/SKILL.md)
- [Research](research/SKILL.md)
- [System](system/SKILL.md)
- [Tasks](tasks/SKILL.md)
- [TTS](tts/SKILL.md)
- [VMware](vmware/SKILL.md)
- [Voucher Access](voucher-access-specialist/SKILL.md)
- [Voucher](voucher/SKILL.md)
- [Windows](windows/SKILL.md)
- [Test](test/SKILL.md)

## Install

Install one skill with the Agent Skills CLI:

```bash
npx skills add br3eze-code/br3eze-code --skill cordova
npx skills add br3eze-code/br3eze-code --skill agentos-live-project-observer
npx skills list
```

The CLI's list command reports skills installed in the current scope; it is not the source catalogue.

## Architecture and release guidance

- [Portable skill operating contract](../docs/skills/operating-contract.md)
- [Multi-agent and IDE integration](../docs/IDE-INTEGRATION.md)
- [Release WBS from discovery to launch](../docs/RELEASE-WBS.md)
- [Real-time observation model](../docs/REALTIME-OBSERVATION.md)
- [Claude Code plugin guide](../docs/CLAUDE-CODE.md)

## Ownership rule

Anything swappable; one owner. Skills define procedures and specialist boundaries. `src/core/agentRuntime.js` remains the single execution owner. IDE plugins are thin adapters, not parallel business logic or runtimes.
