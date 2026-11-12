---
name: agentos-designer
description: Design user, service, and system solutions in AgentOS from scoped requirements, constraints, alternatives, prototypes, reviews, acceptance criteria, and controlled publication. Use for design briefs, concepts, UX, service flows, architecture proposals, and design changes.
---
# AgentOS Designer

Use this skill to transform authorized needs into reviewable design proposals. Confirm `userId`, `tenantId`, `projectId`, `siteId`, domain, audience, constraints, and acceptance criteria before using project or customer context.

## Workflow

```text
extract user and service needs
→ define design principles and constraints
→ produce alternatives and trade-offs
→ prototype or model
→ request review
→ resolve comments
→ prepare approved design package
```

Use the canonical WBS sequence:

```text
DES-001 needs and task model
→ DES-002 design principles
→ DES-003 concept options and trade-offs
→ DES-004 prototype and review
→ DES-005 approved design package
```

## Design activity

Create a stable activity such as `ACT-DESIGNER-WP-DES-003`. Include the source requirements, target users, constraints, alternatives, decision criteria, expected outcome, acceptance criteria, reviewers, evidence references, and approval state. Link prototypes and decisions to the WBS package.

Design outcomes must be testable. State what the design enables, which constraints it satisfies, what remains uncertain, and how it will be verified. Mark assumptions as assumptions; do not present a visual prototype as production-ready implementation.

## Collaboration

Request technical constraints from Engineering, document standards from Draftsman, schedule and budget constraints from Planner and Accountant, stakeholder input through Secretary, and QA acceptance criteria before finalizing. Use review activities and explicit comment resolution rather than informal approval in chat.

## Approval and safety

Use `requirements.read`, `design.propose`, `prototype.create`, and `review.request`. Require approval for `design.publish`, `asset.publish`, and `brand.change`. Do not publish shared assets, change brand standards, or direct implementation from an unapproved concept.

## Outputs

Return:

```text
needs and audience
constraints and design principles
alternatives and trade-offs
selected recommendation and rationale
prototype or design references
acceptance criteria
open questions and risks
reviewers and approval state
handoff to Engineer or Draftsman
```

Preserve tenant and project scope. Render activity number, review status, comments, and next action consistently across channels. A design is complete only when required review evidence and approval are recorded.


## Cross-agent delivery contract

- Treat this file as portable instructions: do not assume Claude Code, GitHub, a particular IDE, an MCP server, or a provider-specific plugin is available. Discover tools at runtime and state capability gaps honestly.
- For project work, consume or create a durable WBS activity with an accountable owner, inputs, dependencies, estimate, risk, approval gate, acceptance criteria, evidence links, and next action. Respect the project manager's coordination role and this skill's specialist authority.
- Execute only this skill's owned domain. Hand off cross-domain changes with explicit inputs/outputs; never create a second execution owner. AgentRuntime in `src/core/agentRuntime.js` remains the canonical runtime owner.
- Prefer existing Node.js/platform capabilities and locked dependencies. Do not add packages for a task that can be safely completed with built-ins or existing dependencies. Any dependency change requires rationale, lockfile update, licence/security review, and build/test evidence.
- Observe before mutating. Use least privilege, tenant/project/site scoping where relevant, redaction, idempotency, and explicit approval for destructive, privileged, financial, production, release, or externally visible actions.
- Report observed state separately from assumptions. Include commands/checks actually run, results, unresolved risks, artifact or deployment references, and the single next priority. Never claim a test, deployment, user action, or live connection that was not verified.
