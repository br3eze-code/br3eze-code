---
name: agentos-role-skill-factory
description: Create, validate, integrate, and release separate AgentOS role-skill packages with SKILL.md instructions and index.js entry points. Use when adding a specialist role, generating role metadata, wiring WBS and approval contracts, or packaging role skills for the repository.
---

# AgentOS Role-Skill Factory

Use this skill to create one or more domain-agnostic AgentOS specialist packages. Each package must contain a validated `SKILL.md` and an executable `index.js` entry point that exports role metadata and a tenant-scoped execution-context factory.

## Workflow

```text
inspect canonical role profile and WBS catalog
→ define responsibility and authority boundaries
→ define skills, approval-required actions, outcomes, evidence, and handoffs
→ initialize or update the skill package
→ write SKILL.md with valid frontmatter
→ write index.js metadata and context factory
→ validate every package
→ copy packages into repository skills/
→ run integration tests and syntax checks
→ review diff, commit, push, and verify remote
```

## Required package contract

```text
skills/agentos-{role}/
├── SKILL.md
└── index.js
```

`SKILL.md` must contain YAML `name` and `description` frontmatter, imperative workflow instructions, role boundaries, approval gates, evidence rules, tenant isolation, activity tracking, channel behavior, and outputs. Keep it concise and under 500 lines.

`index.js` must export:

```js
export const specialist = {
  role,
  kind,
  approvalRequired,
  createContext(input)
};
export const role;
export const createContext;
export default specialist;
```

`createContext` must require at least `userId` and `tenantId`, attach the canonical `agentRole` and `skillPackage`, and expose approval metadata without granting authorization. Runtime policy must re-check identity, tenant, project, site, capability, status, and approval before execution.

## Role design

For every role, document:

```text
purpose and responsibility
allowed skills and read operations
mutation or commitment approvals
WBS packages and dependencies
activity number and expected outcome
evidence and acceptance criteria
handoff targets and escalation rules
channel rendering and privacy limits
onboarding and readiness checks
```

Do not make one role responsible for another role’s authority. Project Manager coordinates; Planner plans; Engineer validates and implements bounded technical work; Accountant reconciles; Secretary records and routes; Procurement sources and compares; Expeditor tracks fulfillment; Designer defines design intent; Draftsman controls drawings; QA verifies; Editor controls revisions and publication.

## Validation

Run the skill validator for every source package:

```bash
python /home/ubuntu/skills/skill-creator/scripts/quick_validate.py /home/ubuntu/skills/agentos-{role}
```

Then validate repository copies, all entry-point imports, missing-context rejection, tenant preservation, and approval metadata. Run focused WBS, activity, channel, POS/order, courier, payment, and specialist integration tests before committing.

## Safety and release

Never include credentials, runtime state, generated databases, or accidental artifacts. Do not commit until the diff is reviewed, whitespace checks pass, tests are reproducible, and the package list is explicit. Push only after the commit is created and verify that local and remote HEAD match.
