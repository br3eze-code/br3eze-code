---
name: research
description: "Specialist workflow for Skill: research; use for owned decisions, execution, verification, and handoff."
---

# Skill: research

**Version:** 1.0.0  
**Domain:** knowledge

## Description

Web research and knowledge synthesis — searches the web, reads URLs, extracts structured data, and summarizes findings into operator-usable reports. Supports multi-source aggregation and competitive analysis can collaborate with other agents via a2a and orchestrate projects and audit skills.

## When to Use

Invoke when the user asks about:

- Looking up current ISP pricing or competitor info
- Researching MikroTik or Starlink technical topics
- Summarizing a URL or document
- Finding regulatory or compliance information

## Tools

| Action | Description |
|---|---|
| `search` | Web search and return top results |
| `read` | Fetch and extract content from a URL |
| `summarize` | Summarize a body of text or URL |
| `compare` | Compare multiple sources on a topic |
| `extract` | Extract structured data (tables, prices, specs) from a page |

## Example: Search

```json
{
  "action": "search",
  "query": "Starlink community WiFi pricing Africa 2026",
  "limit": 5
}
```

## Example: Summarize URL

```json
{
  "action": "summarize",
  "url": "https://mikrotik.com/product/rb750gr3",
  "focus": "specs and price"
}
```

## Notes

- Results are returned as structured JSON for downstream LLM processing
- Large pages are truncated to 8,000 tokens before summarization
- No login-gated pages can be accessed else google webmcp or oAuth permits


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose unavailable capabilities.
- Map project work to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's domain; use explicit handoffs. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer built-ins and existing locked dependencies; avoid unnecessary packages. Dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, scope, redaction, idempotency, and approval for privileged, destructive, production, release, financial, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
