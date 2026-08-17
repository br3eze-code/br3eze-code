# AgentOS production certification scorecard

## Certification rule

AgentOS must not be described as unrestricted production-ready until every Critical gate is **PASS** or has an approved, time-bound exception. A passing unit-test count is not sufficient evidence for deployment, tenant isolation, fleet scale, or operational recovery.

## Scorecard

| Control area | Target | Current status | Required evidence | Owner |
|---|---:|---|---|---|
| Architecture | ≥95 | Partial | Core/plugin boundary import test and manifest review | Project Manager + Engineer |
| Domain isolation | ≥95 | Partial | Remove-domain tests for MikroTik and commerce with core-only boot | Engineer + QA |
| Security | ≥95 | Partial | Dependency remediation, secret scan, authorization and replay tests | Engineer + QA |
| Tests | ≥95 | Partial | Full suite plus scenario, load, restart, and recovery suites | QA |
| CI/CD | ≥95 | Partial | Tag workflow run, image digest, SBOM, provenance, and rollback rehearsal | Engineer |
| Observability | ≥90 | Partial | Metrics, traces, alert routes, dashboards, and incident drill | Engineer + Secretary |
| Plugin isolation | ≥95 | Partial | Plugin enable/disable, failure containment, and restart tests | Engineer |
| Authority | ≥95 | Partial | Tenant → site → resource → action denial matrix | Engineer + QA |
| Audit | ≥95 | Partial | Immutable evidence chain and cross-tenant redaction tests | QA + Secretary |
| Deployment | ≥95 | Partial | Compose or managed-host rollout, migration, backup, restore, and canary | Project Manager + Engineer |

## Current blockers

The current repository still has sixteen moderate transitive dependency advisories, mainly through Firebase/Google Cloud and Cordova/Xcode paths. Docker image build and Compose rendering require a CI or deployment runner because Docker is not installed in the sandbox. Durable fleet snapshot persistence, dead-letter handling, provider-backed 1,000-router load evidence, full PWA/CLI/mobile/desktop parity, and production backup/restore evidence remain open.

## Required release evidence format

Every gate record must include the commit SHA, environment identifier, configuration revision, test or drill command, result, timestamp, operator, and links to logs or artifacts. Secrets and private identities must never be included in the evidence payload.

## Commissioning sequence

The commissioning sequence is: build and scan the image; render and validate Compose; apply database migrations against a disposable environment; verify RLS and tenant boundaries; start gateway and worker; verify health and readiness; run provider contract tests; run a 1,000-target failure-injection test; restart the worker and verify lease recovery; exercise Telegram, WhatsApp, PWA, CLI, mobile, and desktop scope parity; complete backup/restore; canary one tenant; then obtain QA and Project Manager approval.

## Decision states

`DRAFT` means evidence is absent. `PILOT` means controlled tenants only. `CONDITIONAL` means production deployment is allowed with documented exceptions and monitoring. `CERTIFIED` means all thresholds and critical gates pass. The current decision is **PILOT**.
