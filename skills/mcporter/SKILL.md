---
name: mcporter
description: "Specialist workflow for Skill: mcporter; use for owned decisions, execution, verification, and handoff."
---

# Skill: mcporter

**Version:** 1.0.0  
**Domain:** networking

## Description

MikroTik Configuration Porter — backup, export, and restore RouterOS configurations. Creates binary `.backup` files and plaintext `.rsc` exports, and can restore them to the same or a different router node.

## When to Use

Invoke when the user asks about:
- Backing up a router configuration
- Exporting router config as a script
- Restoring a configuration to a router
- Migrating config between routers

## Tools

| Action | Description |
|---|---|
| `mcporter.backup` | Create binary RouterOS backup file |
| `mcporter.export` | Export config as `.rsc` script |
| `mcporter.restore` | Upload and apply a backup/export to a router |
| `mcporter.list` | List saved backups |

## Example

```json
{
  "action": "mcporter.backup",
  "router": "main-gateway",
  "filename": "gateway-2026-05-06"
}
```

## Notes

- Backup files are stored in `data/backups/`
- All backup and restore operations are logged to the audit trail
- Restoring requires `danger-full-access` permission


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose unavailable capabilities.
- Use durable WBS activities for project work with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; hand off cross-domain work explicitly. `src/core/agentRuntime.js` remains the only execution owner.
- Prefer platform built-ins and existing locked dependencies; avoid unnecessary packages. Dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, network, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
