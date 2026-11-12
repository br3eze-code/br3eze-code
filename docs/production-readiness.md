# Production Readiness Checklist — AgentOS / br3eze-code

**Branch:** `production-hardening-2026-11-11`  
**Date:** 2026-11-11  
**Status:** In progress — not yet certified production-ready

This document is the operational go/no-go gate for calling the runtime (or the Autonomous Operator) production-ready. It consolidates the audit findings of 2026-11-11 and the criteria in `docs/architecture/autonomous-operator.md`.

---

## 1. Security (must be green)

| Check | Status | Evidence / Action |
|-------|--------|-------------------|
| Open Dependabot High alerts resolved | 🟡 In progress | `follow-redirects` override added; refresh lockfiles & re-scan |
| Open Dependabot Medium alerts resolved | 🟡 In progress | `minimatch` override added |
| Open Dependabot Low / other alerts reviewed | 🟡 In progress | `fast-xml-parser`, `glob` overrides added |
| Multi-manifest audit (root + server + Cordova + runtime + plugins) | 🔴 Open | Run dependency-inventory workflow; map every lockfile |
| Secrets rotated if historically exposed | 🔴 Open | Review git history + rotate gateway tokens, API keys, signing credentials |
| Secret scanning + repository-hygiene gate pass | 🔴 Open | Confirm CI jobs green on this branch |
| No production secrets in tree or history | 🔴 Open | `.env` never committed; service-role / master keys only in vault |

### Forced overrides (this branch)

```json
"overrides": {
  "osc": { "ws": "8.21.0" },
  "pm2": { "js-yaml": "4.3.1" },
  "follow-redirects": "1.16.2",
  "minimatch": "11.0.1",
  "fast-xml-parser": "5.12.0",
  "glob": "11.0.0"
}
```

After merge of the lockfile refresh, re-run Dependabot / `npm audit` on every surface and close the corresponding alerts.

---

## 2. Verification gates (must pass on the same commit)

| Gate | Command / Workflow | Status |
|------|--------------------|--------|
| Unit + integration tests | `npm test -- --runInBand` | 🔴 Not certified |
| Production test profile | `npm run test:production` | 🔴 Not certified |
| Lint (core paths) | `npm run lint` / `lint:ci` | 🔴 Not certified |
| Type check | `npm run build:types` | 🔴 Not certified |
| Architecture / core-boundary | `npm run check:architecture` + `check:ci-quality` | 🔴 Not certified |
| Repository hygiene | `npm run check:repository-hygiene` | 🔴 Not certified |
| Security workflow | `.github/workflows/security.yml` | 🔴 Not certified |
| Secret scanning | `.github/workflows/secret-scanning.yml` | 🔴 Not certified |
| Build | `npm run build` | 🔴 Not certified |

Record the exact commit SHA and CI run URLs when all of the above are green.

---

## 3. Runtime & architecture (must be true)

| Criterion | Status |
|-----------|--------|
| All production request paths (CLI, HTTP, WebSocket, channels) converge on `AgentRuntime` + authorization boundary | 🟡 Partial — consolidation still in progress |
| No competing AgentEngine / second orchestration loop in live paths | 🟡 Partial |
| Domain-specific behaviour lives in skills / plugins / adapters only | 🟡 Partial |
| Task registry is the single canonical path (`src/core/taskRegistry.js`); legacy `src/taskRegistry.js` retired or proven dead | 🟡 Open |
| Restart recovery marks in-flight tasks interrupted; no silent replay of non-idempotent side effects | 🟢 Foundation present |
| Approval gates enforced for Tier 2/3 actions by default | 🟢 Model present |

---

## 4. Autonomous Operator go/no-go (from architecture doc)

Do **not** claim the operator production-ready until **all** of the following are evidenced on the same commit:

- [ ] Unit, integration, type, lint, architecture, and security checks pass
- [ ] Restart/recovery and duplicate-action tests pass
- [ ] Task and tenant authorization tests pass
- [ ] Budget and timeout enforcement tests pass
- [ ] Backups restore successfully
- [ ] 24-hour unattended test has no lost tasks, uncontrolled retries, or unexplained side effects
- [ ] Deployed build is the tested commit and health/readiness checks pass

---

## 5. Deployment posture

| Item | Requirement |
|------|-------------|
| Node | 22.x only |
| Secrets | Vault / secret manager; never in image or env files committed to git |
| Process | Supervised (systemd / pm2 / container orchestrator); graceful SIGTERM |
| Persistence | Durable store with backup + tested restore before multi-worker |
| Network | Firewall, least privilege, TLS where required |
| Observability | Structured logs, metrics, health/readiness endpoints, alerts |
| Budgets | Explicit model/API spend ceilings and concurrency limits |

---

## 6. Immediate next actions (owner: Brighton / maintainers)

1. **Refresh lockfiles** on this branch (`npm install` at root and in `server/`, then commit the updated `package-lock.json` files). Confirm overrides resolved the alerts.
2. Run the full verification gate list above and paste results into this document (or a dated audit under `docs/audit/`).
3. Close or accept remaining Dependabot alerts with explicit rationale.
4. Finish the boot-path trace so every live entry point uses `AgentRuntime`.
5. Only after the gates are green: update the README “Verification status” table and tag a release candidate.

---

*Generated as part of the 2026-11-11 production-hardening effort. This checklist is the source of truth until the Autonomous Operator go/no-go is fully satisfied.*
