# AgentOS Vulnerability Score and Project Risk Register

## Executive assessment

AgentOS is currently **not production-ready for unrestricted multi-tenant deployment** without a remediation gate. The fresh root-manifest audit reports **87 dependency findings**: 9 critical, 37 high, 29 moderate, and 12 low. The production-scope view remains material at **77 findings**: 8 critical, 34 high, 24 moderate, and 11 low.

The inherited multi-manifest audit also identified **40 critical and 46 high findings across 44 repository surfaces**, concentrated in cross-platform and Cordova manifests, including the `wifi-wizard` plugin. Those counts should be treated as a separate repository-wide risk view until the audit is regenerated from the current synchronized checkout.

> The counts are vulnerability findings, not confirmed exploitable incidents. Reachability, runtime exposure, exploit prerequisites, and compensating controls must be verified package by package.

## Scoring method

The score below is an internal delivery gate, not a CVSS replacement. It combines severity, production reachability, direct dependency exposure, and control maturity.

| Factor | Weight |
|---|---:|
| Critical findings | 10 points each |
| High findings | 5 points each |
| Moderate findings | 2 points each |
| Low findings | 0.5 points each |
| Direct production dependency multiplier | 1.25 |
| Verified isolation, approval, and monitoring controls | subtract up to 20% |

For the current root manifest, the unadjusted weighted exposure is `9×10 + 37×5 + 29×2 + 12×0.5 = 339`. Against a maximum weighted exposure of `870`, the dependency-health score is approximately **61/100**, before considering cross-platform manifests and application-level controls. Applying the production reachability and direct-dependency concerns gives a conservative **security readiness score of 39/100**, corresponding to **Critical** project risk.

The score should improve only after fixes are installed, lockfiles are regenerated, affected code paths are tested, and the production-scope audit is clean or formally excepted.

## Highest-priority dependency exposure

The direct critical/high findings currently include:

| Package | Severity | Direct | Main risk context | Initial treatment |
|---|---|---:|---|---|
| `form-data` | Critical | Yes | Used through Telegram-related dependency paths; review multipart handling and upgrade path | Replace or upgrade Telegram integration; isolate outbound payloads |
| `@whiskeysockets/baileys` | Critical | Yes | WhatsApp channel runtime and authentication surface | Upgrade, rotate sessions, test channel isolation |
| `cordova-plugin-inappbrowser` | Critical | Yes | Mobile/web navigation and external URL boundary | Upgrade or remove; enforce allowlists and scheme checks |
| `undici` | High | Yes | HTTP client surface used by network integrations | Upgrade and regression-test request handling |
| `html-minifier` | High | Yes | HTML transformation and possible untrusted-input processing | Replace/upgrade; prohibit untrusted template execution |
| `mastercard-api-core` | High | Yes | Payment integration and financial data boundary | Vendor patch or isolate behind a hardened adapter |
| `nodemailer` | High | Yes | Outbound email and potentially user-controlled content | Upgrade, constrain headers and templates |
| `puppeteer-core` | High | Yes | Browser automation and Chromium process boundary | Upgrade, sandbox, restrict navigation and downloads |

The inherited multi-manifest audit adds a second priority class: Cordova plugins and platform-specific packages must be audited independently from the root Node manifest. A clean root `npm audit` cannot be used as evidence that Android, iOS, Electron, or embedded web surfaces are safe.

## Project risk register

Scores use probability and impact on a 1–5 scale. Exposure is `P×I`. Red risks require an owner, mitigation date, and explicit release decision.

| ID | Risk | P | I | Exposure | Rating | Owner | Control / acceptance gate |
|---|---|---:|---:|---:|---|---|---|
| SEC-01 | Critical production dependency vulnerabilities remain exploitable | 4 | 5 | 20 | Red | Security Remediation Lead | Patch or isolate all critical runtime findings; no critical with reachable production path at release |
| SEC-02 | High findings in payment, messaging, browser, and mobile integrations | 4 | 5 | 20 | Red | Platform Engineer + Payment Owner | Upgrade, run provider tests, and publish residual-exception record |
| SEC-03 | Cordova/plugin manifests diverge from the root lockfile | 5 | 5 | 25 | Red | Mobile Platform Owner | Generate per-platform SBOM/audit; block release on critical reachable plugin findings |
| SEC-04 | Tenant or identity scope is bypassed at a channel boundary | 3 | 5 | 15 | Red | Security Architect | Every route and handoff derives identity server-side; cross-tenant negative tests pass |
| SEC-05 | Approval state is stale, replayed, or used for a different action | 3 | 5 | 15 | Red | Project Manager Owner | Bind approval to tenant, user, project, package, action hash, expiry, and idempotency key |
| SEC-06 | Raw CCTV URLs, private identities, or credentials enter model/channel context | 3 | 5 | 15 | Red | CCTV + Video Specialist | Redaction tests pass; only approved evidence references are exportable |
| OPS-01 | Durable project/WBS state is unavailable after restart | 3 | 4 | 12 | Amber | Project Manager Owner | Restart recovery test restores session, package, handoff, and approval state |
| OPS-02 | Specialist delegation creates work outside package scope | 3 | 4 | 12 | Amber | PM Coordinator | Role-bound schemas, prohibited fields, QA acceptance, and audit handoff required |
| OPS-03 | Channel continuity duplicates or merges unrelated conversations | 3 | 4 | 12 | Amber | Channel Owner | Continuity key uses tenant, user, conversation, and project; cross-tenant test remains negative |
| REL-01 | Android SDK/build environment blocks mobile release validation | 4 | 4 | 16 | Red | Mobile Platform Owner | Provision reproducible SDK image and pass Android smoke/build gate |
| REL-02 | ESM migration and legacy module conventions create hidden runtime failures | 3 | 4 | 12 | Amber | Runtime Owner | Native ESM tests, syntax checks, and startup/daemon smoke tests pass |
| REL-03 | Root and sub-manifest dependency trees are not reproducible | 3 | 4 | 12 | Amber | Build/Release Owner | Lockfile policy, clean install, SBOM, and reproducible CI artifact |
| COM-01 | Provider costs exceed subscription margin | 3 | 4 | 12 | Amber | Product/Finance Owner | Meter LLM, TTS, video, messages, devices, and contractor outcomes; usage caps enforced |
| COM-02 | Contractor payouts occur before evidence and QA acceptance | 3 | 4 | 12 | Amber | Accountant + QA | Pay only accepted WBS outcomes with idempotent settlement records |
| GOV-01 | Dependabot or advisory access is incomplete, causing undercounting | 4 | 3 | 12 | Amber | Security Remediation Lead | Reconcile local audit, lockfile audit, SBOM, and authoritative advisory feeds |
| GOV-02 | Release exceptions become permanent undocumented debt | 3 | 4 | 12 | Amber | Project Manager | Every exception has expiry date, compensating control, owner, and closure evidence |

## Remediation sequence

### Release gate 0: Contain

Disable or isolate reachable critical features where no safe patch exists. In particular, place payment, browser automation, WhatsApp session handling, and Cordova external navigation behind explicit feature flags and tenant-level allowlists. Do not expose a production tenant to an unreviewed critical integration merely because the root application starts.

### Release gate 1: Patch direct runtime dependencies

Prioritize `@whiskeysockets/baileys`, `cordova-plugin-inappbrowser`, `form-data` paths, `undici`, `mastercard-api-core`, `nodemailer`, and `puppeteer-core`. For packages without a safe upgrade, replace the integration or isolate it in a lower-privilege process. Regenerate lockfiles and run provider-specific tests after every group.

### Release gate 2: Re-audit every platform surface

Run separate audits for root Node, server, tools, Cordova Android, Cordova iOS, Electron, PHP fallback, and packaged desktop artifacts. Produce an SBOM and map each critical/high finding to a runtime path, owner, patch, or accepted exception.

### Release gate 3: Verify application controls

Run negative tests for tenant isolation, PWA↔Telegram continuity, approval replay/expiry, CCTV redaction, payment webhook signatures, contractor settlement, and channel-specific authorization. Security controls must be tested with both authenticated and malformed identities.

### Release gate 4: Operationalize risk management

The Project Manager should create one WBS package per remediation group. Each package should include scope, affected manifests, risk score, owner, cost/time estimate, dependency order, acceptance tests, rollback plan, and evidence links. The QA specialist closes the package only after tests and re-audit evidence are attached.

## Recommended release decision

**Current decision: No unrestricted production release.** A controlled development or isolated pilot may proceed only with critical integrations disabled or explicitly allowlisted, tenant isolation tests passing, durable audit logging enabled, and a written exception register approved by the project owner.

The next measurable target is a security readiness score of at least **75/100**, with **zero unresolved reachable critical findings**, fewer than five reachable high findings under approved exceptions, a reproducible multi-platform audit, and passing cross-tenant/approval/security regression suites.
