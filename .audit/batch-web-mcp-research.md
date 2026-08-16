# Batch API and Web-MCP Research Findings

## MCP authorization and security

Source: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization

The MCP authorization guidance recommends OAuth 2.1 authorization-code flows with PKCE for protected servers, token validation on every request, short-lived tokens, encrypted token storage, HTTPS in production, least-privilege scopes, proper `WWW-Authenticate` challenges, issuer/audience/resource validation, and no credential logging. It also recommends treating `Mcp-Session-Id` as untrusted and not binding authorization to it.

Source: https://modelcontextprotocol.io/docs/draft/tutorials/security/security_best_practices

The MCP security guidance highlights confused-deputy risks in proxy servers, requires per-client consent before delegated third-party authorization, exact redirect URI validation, CSRF state protection, no token passthrough, audience validation, SSRF protections, and tenant/issuer isolation.

## Batch API design

Source: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ECS_Idempotency.html

AWS documents client-token idempotency for mutating operations: retries with the same token and same parameters should return the original result without repeating the mutation, while changed parameters should be rejected as a conflict.

Source: https://codelit.io/blog/api-batch-endpoints

The batch API reference recommends explicit maximum batch sizes, partial-success responses with per-item status, per-operation idempotency keys, retrying only failed items, concurrency limits, weighted rate limiting, and asynchronous job IDs for work exceeding request time limits. It warns against unbounded batches, missing idempotency, opaque 200 responses for partial failure, and treating large batches as synchronous requests.

## AgentOS implementation implications

1. Device capture must produce a trusted, normalized device snapshot rather than allowing raw client headers to establish identity or authorization.
2. User context should be attached once to the authenticated batch request and inherited by every item; item-level tenant, site, role, or capability fields must not override the authenticated context.
3. Batch execution should preserve the existing per-item idempotency behavior while adding a bounded item count and explicit batch/request correlation.
4. Any web-MCP adapter should be treated as a protected resource server: validate the upstream token, issuer, audience, tenant, and scopes; never pass an unvalidated token downstream; isolate browser sessions from authorization state.
5. Web navigation or browser tools should enforce SSRF-safe URL policy, explicit approvals for mutations, audit events, and per-user/session context isolation.
