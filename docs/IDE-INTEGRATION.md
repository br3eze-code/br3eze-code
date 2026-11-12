# Br3eze AgentOS: Multi-Agent and IDE Integration

## Design rule

**Portable skill definitions and workflow contracts are canonical; host plugins are adapters.** Claude Code has its own plugin/marketplace format. Other IDEs may support Markdown skills, MCP, extensions or their own manifests. Do not assume a Claude plugin installs in another IDE.

## Layered architecture

```text
Portable SKILL.md packages
        ↓
WBS activity + tool contracts + approval policies
        ↓
src/core/agentRuntime.js (single execution owner)
        ↓
existing CLI / gateway / API / provider adapters
        ↓
Claude Code plugin | skills.sh | future IDE adapters
        ↓
normalized project events → read-only observer → operator
```

## Supported distribution patterns

- **Agent Skills CLI:** publish portable `skills/<name>/SKILL.md` packages. Use `npx skills add br3eze-code/br3eze-code --skill <name>` after validating repository layout.
- **Claude Code:** package the same procedures under `plugins/agentos/skills/` and expose marketplace commands. Keep these wrapper skills thin and delegate to shared contracts.
- **Other IDEs/agents:** provide portable Markdown plus only the host-specific manifest or launch configuration that is actually supported. Do not claim a native integration before testing it.
- **MCP:** use MCP only if a real server endpoint/stdio process, protocol implementation, tool schemas, authorization and lifecycle tests exist. A folder named `mcp` or a skill mentioning MCP is not proof of an MCP server.
- **CLI/API:** reuse existing AgentOS interfaces. Never implement a second runtime or duplicate user/billing/network business logic in an IDE adapter.

## Interoperability contract

Each tool adapter declares stable tool name, input schema, output schema, required scopes, side-effect class, approval requirement, timeout, idempotency behavior and audit event. Keep schemas versioned and validate inputs at the adapter boundary.

## Real-time assistance

The observer consumes authorized AgentRuntime/gateway events, GitHub checks/PRs, CI, deployment status and optionally local logs. It emits a normalized timeline with WBS IDs and evidence references. Use webhooks/subscriptions when implemented; otherwise use bounded polling with backoff. Redact credentials and private user data before persistence or display.

Local files, localhost, router state and local IDE activity are not visible to cloud agents by default. A local bridge must be explicitly installed, authenticated, scope-limited, logged and revocable.

## Recommended next priority

Complete portable metadata validation and CI first. Then add an authenticated, read-only observer adapter to the existing gateway/event model, test local and cloud source coverage separately, and only then add more IDE wrappers.
