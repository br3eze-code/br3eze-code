---
name: workspace.obsidian
description: Domain-neutral, scoped Obsidian vault access and graph context for agents.
---

# Obsidian Workspace Skill

This skill exposes safe Obsidian operations through the AgentOS runtime. It is not tied to shopping, CCTV, networking, or another product domain.

All operations require an authenticated `userId`. Reads and graph extraction preserve tenant, domain, and site scope in audit context. Note mutations require an explicit approved context:

```js
{
  userId: 'user-123',
  scope: { tenantId: 'tenant-a', domain: 'workspace', siteId: 'site-1' },
  approval: { approved: true }
}
```

Provide an adapter in `context.obsidianAdapter` for embedded applications, or configure `AGENTOS_OBSIDIAN_VAULT` for a local vault path. Vault paths are always relative and path-confined. Raw coordinates and unrelated location data are not forwarded to Obsidian.

Available tools include status, note reads, bounded graph context, encoded note opening, approved writes, and approved note creation.
