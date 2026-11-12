---
name: windows
description: "Specialist workflow for Skill: windows; use for owned decisions, execution, verification, and handoff."
---

# Skill: windows

**Version:** 1.0.0  
**Domain:** system

## Description

Windows Server management via PowerShell remoting (WinRM). Supports service control, process management, Event Log queries, Active Directory user unlocking, and server reboots.

## When to Use

Invoke when the user asks about Windows services, processes, Event Log, AD accounts, or rebooting a Windows host.

## Tools

| Tool | Risk | Description |
|---|---|---|
| `win.service.status` | low | Get Windows service status (`*` for all) |
| `win.service.restart` | medium | Restart a named service — requires `reason` |
| `win.process.list` | low | Top processes by CPU or memory |
| `win.process.kill` | high | Kill process by PID — requires `reason` |
| `win.eventlog.query` | low | Query System/Application/Security event log |
| `win.ad.user.unlock` | medium | Unlock AD user account — requires `reason` |
| `win.system.reboot` | high | Reboot Windows Server — requires `reason` |

## Example

```json
{ "host": "dc01", "samAccountName": "jsmith", "reason": "Locked after VPN attempt" }
```

## Notes

- All medium/high-risk actions require an explicit `reason` string (logged with user ID)
- `host` must match a configured workspace `windows_hosts` entry
- Commands run via `Invoke-Command` over WinRM using stored credentials


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- Map project work to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; use explicit handoffs across domains. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, tenant/project/site scope, redaction, idempotency, and approval for privileged, destructive, financial, network, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
