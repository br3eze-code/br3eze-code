# Claude Code integration for Br3eze AgentOS

This repository offers two separate distribution paths. Do not confuse skill packages with a Claude Code plugin marketplace.

## Install the Claude Code plugin

In a Claude Code terminal session:

```text
/plugin marketplace add br3eze-code/br3eze-code
/plugin install br3eze-agentos@br3eze-agentos-marketplace
```

Then start a new session or run `/reload-plugins`. To test the plugin directly from this checkout before the PR is merged, run `claude --plugin-dir ./plugins/agentos` from the repository root. The plugin provides:

- `/br3eze-agentos:users` — scoped platform/hotspot user workflows.
- `/br3eze-agentos:server` — local web server and gateway operations.
- `/br3eze-agentos:pr-health` — pull-request and CI health audit/repair.
- `/br3eze-agentos:schedule` — distinguish cloud scheduled routines from local services.

The repository is the marketplace source; plugin installation does not grant server credentials, router access, production permissions, or an authenticated operator identity. Review plugin files before enabling them because plugin commands and MCP processes run with the user's permissions.

## Install an individual Agent Skill

The `skills/` directory also follows the Agent Skills package layout:

```bash
npx skills add br3eze-code/br3eze-code --skill agentos-project-manager
npx skills list
```

Use an actual skill directory name after `--skill`. `npx skills list` lists skills installed in the current scope, not all source packages in this repository. This path installs skill instructions; it does not register executable modules with AgentRuntime.

## Run the local web server

From a local clone, with Node.js 22.x and dependencies installed:

```bash
npm install
npm run serve:dev
curl -fsS http://127.0.0.1:3000/_serve/health
```

The web server uses `scripts/serve.mjs`, mounts the existing API app, and binds to loopback by default. It is distinct from the AgentOS gateway:

```bash
node bin/agentos.js gateway
```

The gateway requires completed onboarding/configuration. Do not start duplicate instances or expose the service to network interfaces without explicit approval and security review.

## Claude Code scheduled routines

Use Claude Code's `/schedule` for recurring cloud tasks such as a daily PR/CI report. Use `/loop` for short-lived polling within an active local session. Cloud routines do not automatically have access to private `localhost`, a local SQLite database, a private router, or local processes. Keep local services under an approved local process manager/OS service; deploy remote services through the approved hosting adapter.

Suggested safe routine prompt:

> Every weekday, inspect all open PRs in br3eze-code/br3eze-code. Report merge conflicts, failed or pending checks, review blockers, draft status, dependency overlap, and stale branches. Suggest targeted repairs and open a PR only for a bounded fix. Never merge PRs, bypass required checks, change permissions, or mutate production infrastructure automatically.

## Safety and architecture

- One execution owner: `src/core/agentRuntime.js`; skills describe procedures and do not create a parallel runtime.
- One gateway owner; reuse existing server and API entry points.
- User administration starts read-only. Verify account type, environment, operator identity, and policy before mutations. Destructive or privilege-changing actions require explicit approval.
- Provider-specific code stays behind adapters. A listed integration is not proof of configured credentials or live connectivity.
- Verify outcomes and report evidence. Do not claim local tests or plugin validation were run unless they actually were.


## Portable skills and full release workflow

The Claude Code plugin is only one adapter. Canonical specialist packages live in `skills/<name>/SKILL.md` and can be consumed by compatible agent hosts. Use the portable skill names `cordova`, `agentos-web-design`, `agentos-android-release`, `agentos-vercel-deploy`, `agentos-live-project-observer`, and `agentos-multi-agent-ide` for staged delivery and cross-agent coordination.

Use [the release WBS](RELEASE-WBS.md) as the baseline from discovery through design, implementation, QA, security, Vercel preview/production, Android internal testing, approved distribution and launch monitoring. Each activity must have one accountable owner and evidence. A local build is not proof of Play publication or a successful Vercel deployment.

The live observer is read-only by default. It can only report on sources that are actually connected; a cloud routine cannot inspect local IDE activity or localhost without an approved authenticated bridge. See [real-time observation](REALTIME-OBSERVATION.md) and [multi-IDE integration](IDE-INTEGRATION.md).

**Next priority:** make portable skill metadata validation pass in CI, then resolve the existing dependency/build and test failures before enabling continuous observation or adding more host-specific plugins.
