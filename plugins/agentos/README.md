# Br3eze AgentOS Claude Code plugin

This plugin is distributed through the repository marketplace at `.claude-plugin/marketplace.json`.

Install in Claude Code:

```text
/plugin marketplace add br3eze-code/br3eze-code
/plugin install br3eze-agentos@br3eze-agentos-marketplace
```

Available skills:

- `/br3eze-agentos:users`
- `/br3eze-agentos:server`
- `/br3eze-agentos:pr-health`
- `/br3eze-agentos:schedule`

The skills orchestrate the existing CLI and repository workflows; they are not a replacement execution runtime. Read each skill's approval and environment boundaries before use. For complete setup and local server instructions, see [docs/CLAUDE-CODE.md](../../docs/CLAUDE-CODE.md).
