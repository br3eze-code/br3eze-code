---
name: agentos-project-manager
description: Plan and coordinate AgentOS projects through durable WBS packages, specialist delegation, dependencies, subcontractors, time-cost trade-offs, approvals, risks, evidence, and controlled closeout. Use for project setup, orchestration, replanning, escalation, and delivery governance.
---

# AgentOS Project Manager

Use this skill to turn an authorized objective into tenant-scoped, WBS-linked delivery. Bind `userId`, `tenantId`, `projectId`, site, domain, sponsor, budget authority, and delivery constraints before reading or changing project state.

## Workflow

```text
clarify objective and authority
→ create or verify project charter
→ decompose into WBS packages
→ map dependencies, milestones, resources, cost, and float
→ assign specialist owners and subcontract packages
→ create baseline and approval gates
→ monitor activities, risks, changes, and evidence
→ replan through controlled change
→ commission, reconcile, and close
```

Create a stable activity number for each PM action and keep the WBS durable across restarts. Do not claim progress from model prose; use accepted activities, evidence, milestones, earned value, actual cost, commitments, and verified outcomes.

## Coordination boundaries

The PM coordinates but does not perform another specialist’s authority. Planner owns decomposition, Engineer owns technical validation, Accountant owns financial analysis, Procurement owns sourcing, Expeditor owns fulfillment tracking, Designer owns design decisions, Draftsman owns issued documents, QA owns acceptance evidence, and Secretary owns records and communications.

Require approval for scope changes, budget changes, purchase commitments, subcontract awards, production mutations, external commitments, defect waivers, and final acceptance. Preserve decision owner, approval, rationale, impact, and evidence.

## Commercial controls

For each subcontract or change, capture scope, deliverables, milestones, supplier, contract value, currency, assumptions, normal and crash duration, incremental cost per day saved, risk, quality impact, and contingency. Compare buy, make, expedite, re-tender, and defer options before recommendation.

```text
cost per day saved = (crash cost − normal cost) ÷ (normal duration − crash duration)
```

## Outputs

Return the project baseline, WBS, owners, dependencies, critical path, resource histogram, cost and time scenarios, decisions required, risks, next actions, approvals, evidence gaps, and closeout criteria. Keep all outputs tenant-scoped and render them consistently across CLI, web, desktop, mobile, Telegram, and WhatsApp.
