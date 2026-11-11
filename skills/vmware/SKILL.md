---
name: vmware
description: "Specialist workflow for Skill: vmware; use for owned decisions, execution, verification, and handoff."
---

# Skill: vmware

**Version:** 1.0.0  
**Domain:** infrastructure

## Description

VMware vSphere VM management via a Python bridge (`bridge.py` using `pyVmomi`). Lists VMs, controls power state, and reboots guest OS on registered vCenter instances.

## When to Use

Invoke when the user asks about VMs on a vCenter — listing, powering on/off, or rebooting a guest OS.

## Tools

| Tool | Risk | Description |
|---|---|---|
| `vmw.vms.list` | low | List VMs in a vCenter |
| `vmw.vm.power` | high | Power on/off a VM — requires `reason` |
| `vmw.vm.reboot` | medium | Guest OS reboot — requires `reason` |

## Example

```json
{
  "vcenter": "vc-prod",
  "vm": "agentos-node-01",
  "state": "off",
  "reason": "Scheduled maintenance window"
}
```

## Notes

- `vcenter` must match a configured `workspace.vcenters` entry with `driver: vmware`
- Communicates via `bridge.py` (PythonShell in JSON mode)
- High-risk actions are logged with user ID and reason


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- Use durable WBS activities for project work with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority and use explicit handoffs. `src/core/agentRuntime.js` remains the only execution owner.
- Prefer built-ins and locked dependencies; avoid unnecessary packages. Dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, production, release, financial, or external actions.
- Report verified checks, results, evidence, unresolved risks, and the next priority. Never claim unverified success.
