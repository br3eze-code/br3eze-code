---
name: email
description: "Specialist workflow for Skill: email; use for owned decisions, execution, verification, and handoff."
---

# Skill: email

**Version:** 1.0.0  
**Domain:** communication

## Description

Send and manage emails across multiple provider backends — SMTP, SendGrid, AWS SES, and Gmail API. Used by AgentOS for operator digests, voucher notifications, and system alerts.

## When to Use

Invoke when the user asks about:
- Sending a notification or report by email
- Emailing a voucher code or QR code to a customer
- Reading or searching received emails
- Deleting email messages

## Tools

| Action | Description |
|---|---|
| `send` | Send an email with optional attachments |
| `read` | Read/fetch emails from inbox |
| `search` | Search emails by query |
| `delete` | Delete an email message |

## Providers

| Provider | Description |
|---|---|
| `smtp` (default) | Standard SMTP server |
| `sendgrid` | SendGrid transactional API |
| `aws-ses` | Amazon Simple Email Service |
| `gmail-api` | Gmail REST API (OAuth2) |

## Example: Send Email

```json
{
  "action": "send",
  "provider": "smtp",
  "to": "operator@example.com",
  "subject": "Daily Revenue Report",
  "body": "Today's revenue: $45.00 across 9 vouchers.",
  "attachments": []
}
```

## Permissions

- `email:send` — required to send emails
- `email:read` — required to read/search/delete emails


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose unavailable capabilities.
- Use durable WBS activities for project work, with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; make explicit handoffs across domains. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, scope, redaction, idempotency, and approval for privileged, destructive, financial, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
