# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                 # install deps
npm run setup                # interactive onboarding wizard (agentos onboard)
npm start                    # node bin/agentos.js gateway — starts the daemon
npm run dev                  # nodemon bin/agentos.js --dev
npm test                     # jest --coverage (--experimental-vm-modules), runs tests/**/*.test.js
npx jest tests/unit/mikrotik.test.js   # run a single test file
npx jest -t "name of test"   # run tests matching a name
npm run lint                 # eslint .
npm run lint:fix
npm run format                # prettier --write "src/**/*.js"
npm run build                 # tsc --project tsconfig.json (only compiles .ts under src/, extentions/, vscode-extension/, typings/ — the CJS app code is NOT type-checked by this)
npm run build:check           # tsc --noEmit
npm run db:migrate            # node scripts/migrate-vouchers.js
npm run security:audit        # npm audit && node scripts/security-check.js
```

CLI usage once running: `agentos <command>` (see `src/cli/commands/`) — e.g. `agentos status`, `agentos network ping 8.8.8.8`, `agentos users kick <name>`, `agentos voucher create 1Day`, `agentos doctor [--fix]`. Running `agentos` with no recognized subcommand defaults to `gateway` (see `main.js`).

Jest config lives inline in `package.json` (`testMatch: tests/**/*.test.js`, `testTimeout: 15000`, coverage collected from `src/core/*.js`, `src/utils/*.js`, `adapters/*.js`, `agents/*.js`, `tools/system/*.js`). ESLint is CommonJS/ES2022, `no-console` is off, unused vars prefixed `_` are ignored (`.eslintrc.json`).

## What this project is

AgentOS — a conversational AI layer for managing MikroTik RouterOS networks (hotspot billing, user/voucher management, firewall, monitoring) via Telegram, WhatsApp, Slack, Discord, WebSocket CLI, and REST. Node 22+, CommonJS (`"type": "commonjs"`).

Note: `package.json`'s `main` field points at `src/core/gateway.js`, but that file is **not** what actually runs — see the real boot chain below. Only `bin/agentos.js` / `bin/agentos-esm` (`agentos.mjs`) are wired as executables.

## Architecture — the live spine vs. legacy code

This codebase has been rewritten/migrated multiple times in place, so many near-duplicate files coexist (e.g. `agentKernel.js`/`agentEngine.js`/`agent-runtime.js`/`agentRuntime.js`, three "gateway" files, five "session" files, `database.js` vs `database-enhanced.js`). **Most of `src/core/` is legacy and not on the live require path.** Before editing a file, check whether it's actually reachable from the real entry point below — don't assume a file matters just because it's in `src/core/`.

**Real boot chain:**
```
bin/agentos.js  (shim: require('../main.js'))
  -> main.js  (Commander program root; sets global.AGENTOS; default command = gateway)
    -> src/cli/commands/*.js   (onboard, ask, gateway, networks, users, voucher, config,
                                 doctor, domain, status, dashboard, skill, dahua, wacli,
                                 telegram, google, update, tailscale, cli, login)
      -> src/core/{mikrotik, database, config, financial, universal-billing,
                    discovery, node-registry, ask-engine}.js
      -> src/core/memory/MemoryManager.js
      -> src/core/llm/LLMCoordinator.js   (constructed in agentos ask/onboard/doctor,
                                             injected into AskEngine as `ai` — not required
                                             by ask-engine.js itself)
      -> src/core/gateway-engine.js   (the REAL gateway — WS + HTTP, agentos gateway)
           -> src/core/channels/ChannelManager.js  (-> TelegramChannel, WhatsappChannel,
                                                        SlackChannel, DiscordChannel, etc.)
           -> src/api/mobile-bridge.js
           -> src/ai/coordinator.js   (AICoordinator — Gemini-driven skill/tool dispatch)
           -> src/core/security.js, metrics.js, logger.js
```

- **`src/core/gateway-engine.js`** is the live gateway. `src/core/gateway.js` and `src/core/gateway-daemon.js` are old/thin — not part of the real path (gateway-daemon just wraps gateway-engine but nothing calls it from the CLI).
- **`src/core/database.js`** is the live DB layer (Firebase/local JSON, required in a dozen+ places). `database-enhanced.js` has no requirers — dead.
- **Two parallel AI-routing implementations exist and do NOT call each other:**
  - `src/core/ask-engine.js` — rule/LLM hybrid, used by `agentos ask` and the gateway's HTTP `POST /api/v1/ask` (SSE streaming via `.stream()` or one-shot via `.run()`). It doesn't require an LLM client itself; the caller (`agentos ask`, or `agentos gateway` via `GoogleGenerativeAI`) constructs one and passes it in as `ai`.
  - `src/ai/coordinator.js` (`AICoordinator`) — Gemini-specific skill/tool dispatch, wired into the WebSocket gateway/channels layer.
  - Don't assume a fix to one covers the other.
- **`src/core/SkillRegistry.js`** (used by `agentos skill`) and **`src/core/skills/SkillRegistry.js`** (used by `src/ai/coordinator.js`) are two different files with the same class name — check which one a call site actually imports.
- **Confirmed dead code** (no requirers found anywhere in the live path): root `agentos.js` (a 4000+ line legacy monolith with its own Express/WS/Firebase/MikroTik logic), root `mcp.js` (standalone MCP stdio server over `devices/`/`core/device-registry`, self-invoked, orphaned), root `onboard.js` (superseded by `src/cli/commands/onboard.js`), `src/core/routes.js` and `src/core/orchestrator.js` (an in-progress "migrated from ss35.js" rewrite, referenced only by `src/core/AgentOS.js`, which itself is required only by `tests/AgentOS.test.js` — test-only, not live), `src/core/database-enhanced.js`, `src/core/ToolRegistry.js` and `src/core/loadDomain.js` (its only consumer, also unreferenced), `src/harness/*`, `src/kernel.js`, the `agentKernel`/`agentEngine`/`agent-runtime`/`agentRuntime` family, top-level `tools/registry.js`, top-level `skills/SkillRegistry.js`.
- If you're asked to modify "the orchestrator" or "the AI coordinator," clarify which of the parallel implementations is meant — the names are reused across live and dead code.

### Other real subsystems
- **RouterOS interaction**: `src/core/mikrotik.js` via `routeros-client`; `agentos-sentinel.rsc` / `mikro.rsc` are native RouterOS scripts uploaded directly to routers (not part of the Node process).
- **Billing/vouchers**: `src/core/universal-billing.js`, `src/core/voucher.js`, `src/core/financial.js`; Mastercard A2A (OAuth 1.0a RSA-SHA256) payment flow reconciled via webhook.
- **Skills**: pluggable capabilities under `skills/` and `src/core/skills/` (mikrotik, calendar, email, tasks, tts, etc.), discovered/registered through a `SkillRegistry` — see the "two registries" caveat above.
- **Memory**: `src/core/memory/MemoryManager.js`, constructed with an adapter name from `config.memory.adapter` (default `'memory'`) and used by both `agentos ask` and `agentos gateway`.
- **Config**: `src/core/config.js` exposes `BRAND`, `CONFIG_PATH`, `STATE_PATH`, `getConfig()`; per-profile state lives under `~/.agentos` (or `~/.agentos-<profile>` via `AGENTOS_PROFILE` env var / `--dev` flag).
- **Tests**: `tests/unit/*`, `tests/integration/*`.

## Conventions from CONTRIBUTING.md

- Prefer async/await.
- Keep skills modular under `skills/`; register new ones in `skills/manifest.yaml` and document them in `SKILL.md` (which describes the 3-tier ReAct dispatch: Tier 1 keyword match, Tier 2 regex rule, Tier 3 LLM ReAct loop — see `SKILL.md` for the full tool registry, permission tiers, and cron schedule).
- Run `npm run lint` before submitting changes.
