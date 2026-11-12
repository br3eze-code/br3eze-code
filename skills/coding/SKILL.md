---
name: coding
description: "Specialist workflow for Skill: coding; use for owned decisions, execution, verification, and handoff."
---

# Skill: coding

**Version:** 1.0.0  
**Domain:** development

## Description

Code generation and execution for AgentOS automation tasks. Generates MikroTik scripts, Node.js snippets, shell commands, and RouterOS configuration blocks. Supports syntax validation before execution.

## When to Use

Invoke when the user asks about:
- Generating a RouterOS script for a specific task
- Writing a Node.js helper or automation snippet
- Generating shell commands for the AgentOS host
- Validating code before running it

## Tools

| Action | Description |
|---|---|
| `generate` | Generate code from a natural language description |
| `validate` | Check code for syntax errors and safety issues |
| `execute` | Run a validated script (sandboxed) |
| `explain` | Explain what a code snippet does |
| `refactor` | Improve or clean up existing code |

## Example: Generate RouterOS Script

```json
{
  "action": "generate",
  "language": "routeros",
  "description": "Block all traffic from IP 10.0.0.55 on the hotspot interface"
}
```

## Supported Languages

- `routeros` — MikroTik RouterOS scripting language
- `javascript` / `nodejs` — Node.js
- `bash` — Shell scripts for Linux
- `powershell` — Windows PowerShell

## Safety Rules

- `execute` only runs in a sandboxed environment
- RouterOS scripts are validated against the shell-injection denylist before execution
- No `eval()` or dynamic code loading in generated JavaScript


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime rather than assuming a provider-specific plugin.
- Map project work to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Own this skill's domain only; hand off cross-domain work explicitly. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer existing platform capabilities and locked dependencies; do not add packages without a clear need. Dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Apply least privilege, project/site scope, redaction, idempotency, and explicit approval for destructive, privileged, production, release, or external actions.
- State checks actually run, results, evidence, risks, and the next priority. Never claim unverified success.
