# AgentOS Monetization Model

## Positioning

AgentOS should monetize as a **tenant-scoped operations platform** rather than as an unrestricted chatbot. The paid unit is the customer’s managed operating environment: projects, WBS execution, specialist delegation, channel continuity, CCTV/network workflows, commerce operations, and auditable approvals.

Pricing below is an initial commercial hypothesis for validation with customers. It is not a guarantee of revenue or profitability; payment processing, infrastructure, support, taxes, contractor commissions, and regional purchasing power must be validated before publication.

## Recommended plans

| Plan | Intended customer | Monthly platform fee | Included usage | Primary limits |
|---|---|---:|---|---|
| Starter | One operator or small site | $19–$29 | 1 tenant, 3 projects, 2 channels, 2 specialist roles | No multi-site delegation; capped automation |
| Business | Small operations team | $99–$149 | 1 tenant, 10 users, 15 projects, PWA plus Telegram/WhatsApp, all core specialists | Usage-metered media, advanced WBS and approvals |
| Pro Fleet | Multi-site network, CCTV, or commerce operator | $399–$699 | 1 tenant, 50 users, 100 projects, multi-site context, all specialist roles, priority support | Metered devices, video renders, and high-volume actions |
| Enterprise | Partner platform or white-label operator | Custom annual contract | Tenant hierarchy, SSO, data residency, custom connectors, SLA, dedicated workers | Contracted capacity and support terms |

The platform fee should remain predictable. Variable charges should apply only to expensive or externally metered operations such as video rendering, transcription, high-volume device polling, premium model calls, outbound messaging, and contractor data-hunting work.

## Usage-metering dimensions

Each billable event should be recorded with tenant, user, project, WBS package, channel, provider, model, quantity, unit, and idempotency key. Recommended meters include:

| Meter | Example unit | Billing rule |
|---|---|---|
| Specialist execution | completed work package | Included allowance, then per-package charge |
| LLM usage | input/output token bundle | Provider cost plus controlled margin |
| Seedance video | rendered second or approved export | Price by duration and resolution |
| TTS | audio character or minute | Provider cost plus margin |
| CCTV/network operations | managed device-month or action bundle | Device tier plus high-risk action approval |
| Channel delivery | outbound message/media | Included allowance, then pass-through plus margin |
| Contractor data hunting | accepted verified result | Commission from the customer-approved work order |

The event ledger must be append-only and reconcile against provider receipts. A failed, retried, or duplicate request must not create duplicate charges; use an idempotency key derived from tenant, operation, request, and provider attempt.

## Contractor commission model

Data-hunting and specialist work should be commissioned from **accepted outcomes**, not raw activity. A WBS package defines the scope, evidence requirements, acceptance test, and maximum commission before delegation. The accountant role verifies the package outcome and the Project Manager closes it only after QA acceptance.

A practical initial split is:

| Work type | Contractor share | Platform share | Notes |
|---|---:|---:|---|
| Verified product or vendor data | 60% | 40% | Pay only accepted, deduplicated records |
| Qualified procurement comparison | 50% | 50% | Requires source evidence and QA review |
| Approved video or creative package | 50% | 50% | Pay after customer approval or defined milestone |
| High-risk operational remediation | 40% | 60% | Platform carries infrastructure, audit, and support cost |

These percentages are starting points for negotiation and must be reviewed against actual support, payment, tax, and dispute costs.

## Approval-gated monetization

The following actions should create a proposal before execution: purchase-order commitment, budget change, paid provider invocation above the tenant threshold, video publication, mass channel delivery, device suspension, and contractor payout. The proposal should display the expected charge, target scope, evidence, and consequence. Confirmation must be bound to the same tenant, user, project, WBS package, action hash, and expiry window.

A failed approval should incur no customer-side execution charge. A provider job that has already started should be recorded as a provider cost and reconciled according to the plan’s retry policy.

## Product-led upgrade path

The PWA should expose value before asking for an upgrade. Starter users can view a WBS preview and run low-cost planning actions. Upgrade prompts should appear when the user reaches a concrete boundary: a second channel, additional project, multi-site CCTV context, video export, specialist handoff, or contractor work order.

The upgrade message should state the exact capability being unlocked, the recurring fee, and any variable charge. Do not hide metered operations behind vague “AI credits.” Show remaining allowance, projected cost, and an audit link in the Project Manager state view.

## Implementation hooks in AgentOS

The Project Manager route can attach monetization metadata to every proposal:

```js
{
  tenantId,
  projectId,
  packageId,
  operation: 'prepare_channel_render',
  plan: 'business',
  meter: 'seedance_video_seconds',
  quantity: 20,
  includedRemaining: 120,
  estimatedCharge: 0,
  approvalRequired: true,
  idempotencyKey: '...'
}
```

The billing layer should consume approved events asynchronously, while the WBS record remains the source of truth for work status and acceptance. Billing must not be inferred from a chat message or browser state.

## Initial go-to-market sequence

Start with one high-value wedge: **multi-site CCTV and network operations with a Project Manager that coordinates procurement, video, QA, and field work**. Sell a paid pilot with a fixed setup fee, a monthly platform fee, and transparent metering for video, messaging, and managed devices. Convert successful pilots to Business or Pro Fleet contracts after the customer has measurable evidence of reduced response time, clearer audit trails, or faster procurement cycles.

The first commercial dashboard should show active projects, accepted work packages, avoided rework, approval turnaround, device coverage, rendered media, contractor outcomes, and monthly usage cost. These measures support renewals more effectively than generic chatbot message counts.
