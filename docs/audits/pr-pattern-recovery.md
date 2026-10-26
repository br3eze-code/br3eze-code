# PR and branch pattern recovery ledger

Updated: 2026-10-26

## Rule

Treat `main` as the destination. Audit historical PRs and branches as sources of patterns; do not merge old branch histories wholesale. Compare each candidate file with the current canonical owner and port only missing, compatible behavior. Keep networking, Wi-Fi, RouterOS, vouchers, cameras, and hardware integrations as optional domains/adapters.

This is a working ledger, not a claim that every PR has already received a complete line-by-line review.

## Landed on `main` in this recovery pass

- Extracted shared Express middleware composition to `server/src/core/configureHttpApplication.js`.
- Moved Wi-Fi product settings to `server/src/domains/wifi/config.js` and Wi-Fi HTTP route registration to `server/src/domains/wifi/registerRoutes.js`.
- Added route-composition and PHP/Node route-parity tests.
- Replaced the placeholder security policy, split CI syntax/type checks, and removed unresolved merge-conflict markers from the Firebase workflow.
- Added runtime evaluation/replay/workflow/usage/framework-adapter tests and a capability-route identity-context assertion.
- Added `AGENTOS_DOMAIN` opt-in boundaries to host bootstrap, CLI command registration, gateway RouterOS initialization, domain loading, and skill discovery. `network`, `wifi`, and `wifi-billing` preserve legacy network behavior; other selected domains avoid importing RouterOS adapters and exclude network-only skills from the gateway runtime.
- Added a non-network environment example and deployment notes.
- Replaced the server login's shared-secret response with a short-lived HMAC-signed user token. Added Firebase/Supabase/service identity verification and tests. Only `AGENTOS_SERVICE_TOKEN` grants service-token authority; `GATEWAY_TOKEN` is not treated as a service credential.
- Hardened the autonomous audit workflow so AI-generated patches go to a review PR and trigger an explicit CI run instead of being pushed directly to `main`; removed the tracked WhatsApp auth placeholder and ignored local WhatsApp auth state.
- Restored an `AgentRuntime.executeTurn()` compatibility method that delegates to the canonical `execute()` path.
- Added an optional native MCP client boundary (`src/adapters/mcp-client.js`) for stdio, Streamable HTTP, and legacy SSE transports, with explicit tenant authorization, namespaced tools, schema preservation, and MCP error handling. SDK loading is deferred until MCP is enabled; see `docs/architecture/mcp-client.md`.
- Corrected `package.json`'s `main` entry from the missing `src/core/gateway.js` to `src/core/agentRuntime.js`.
- Restored the missing partner policy and job-state-machine regression tests.
- Ported the unique `package-lock.json` update from `v0/br3eze-code-22012066` after verifying the root dependency metadata and every shared package version matched `main`. The branch had 105 additional package nodes; no shared package version was changed by this port.

## Historical PR findings

| PR(s) | Finding | Decision/status |
|---|---|---|
| #1–8 | Dependency-only updates to the lockfile and direct package versions. Current main already has newer versions than the reviewed patches (for example, Axios 1.20.0, Nodemailer 9.1.1, basic-ftp 5.3.1, and @xmldom/xmldom 0.9.12). | Superseded; do not replay the old versions. The v0 branch's unique lockfile completeness change was ported after version parity checks. |
| #9 | Added the autonomous AI audit workflow, a broad skill-chain runner, and a tracked file under `.whatsapp-auth/`. The workflow originally committed AI-generated source patches directly to `main` with `contents: write`. | Hardened on main: local WhatsApp auth state is ignored and the tracked placeholder file was removed. The audit workflow now opens a review PR rather than pushing patches to main, and explicitly dispatches CI for that review branch. |
| #10–11 | Repeated 477-file repo-wide snapshots containing multiple domain integrations, generated platform files, legacy runtime paths, and the autonomous audit workflow. | Do not port these snapshots wholesale. The workflow and auth-state safety issues found in this family are now hardened; continue file-level comparison for any remaining unique behavior. |
| #12–20 | Dependency/lockfile updates only. | Current main has newer versions than the reviewed package bumps; do not replay old versions. |
| #21 | Another 631-file repository snapshot with generated/debug artifacts, signing files, a service-account JSON path, and many domain-specific additions. The named keystore/service-account artifacts are absent from current main. | Do not copy the snapshot. Removed non-placeholder gateway, Telegram, and RouterOS credential values from tracked `config/config.json` and added a regression test. Because those values existed in Git history, rotate the corresponding credentials; deleting the current file values does not revoke historical exposure. |
| #22–33, #40–41, #43–44 | Dependency bumps and narrow deploy/Play Store workflow revisions. | Dependency bumps are superseded; no old versions replayed. |
| #34–39, #42 | Workflow permission/security revisions and GitHub Action major-version bumps. The unique current patterns include `actions/checkout@v7` and `actions/upload-artifact@v7`; checked workflows contain no conflict markers or direct push to main. | Ported checkout v7 to the remaining v4 references and artifact v7 to the remaining v4 references in the relevant workflow set. Current releases support these major versions; still require live CI validation. |
| #99–109 | Mostly dependency/Snyk automation and assorted feature PRs; each needs version or caller comparison, not branch-level cherry-picking. | Continue auditing in small batches. A fresh vulnerability audit is still required. |
| #45 | Large generated Cordova/Android platform and signing-related diff. | Do not copy generated platform output or signing material into the general-purpose core. The named keystore and service-account JSON files are absent from current `main`; ignore rules cover these credential types. |
| #50 | Very large CommonJS-to-ESM migration touching hundreds of files. | Current `main` is already ESM-oriented. No wholesale historical copy. Audit only concrete remaining interop defects. |
| #57 | Large Dahua/CCTV integration. | Keep it domain-specific and optional; do not import it into Core. |
| #64 | Payment/billing test coverage. Four listed test files already exist. The missing legacy `payment-gateway.test.js` targets a different API than the current `src/payments/payment-gateway.js` facade. | Do not copy that stale test unchanged; create tests against the current payment-platform contract if coverage is still missing. |
| #78 | Large ESM interop / Wi-Fi plugin and application change. | Not copied wholesale. Continue auditing concrete interop fixes against current callers and module exports. |
| #88 | Partner job, ledger, onboarding, policy, state-machine primitives. | Core partner files already exist. Restored the missing policy and state-machine tests. |
| #100 | Production quality gates, security policy, ignore rules, onboarding and utilities. | Ported the useful security policy and CI check separation. Never port its keystore/service-account credential artifacts. |
| #110–118 | Product funnel and network-adapter features. | Keep product and networking changes in domain adapters; audit selectively rather than placing them in Core. |
| #119 | WBS safety plugin files. | Already present on `main`; no duplicate copy. |
| #122 | Large runtime/domain/bootstrap and CI patch. | Most relevant runtime/domain primitives are already represented in current `main`; continue comparing by canonical file before any further port. |
| #123–125 | Runtime evaluation/replay, framework/protocol adapters, and WBS/control-plane patterns. | Relevant modules already exist. Added additional regression coverage rather than duplicate implementations. |
| #126 | Cordova background-runtime and maintained-fork patterns. | Merged history exists; only port further changes when a current mobile adapter gap is demonstrated. |
| #131–140 | WBS safety, skills/tools pipeline, domain-neutral core ports, partner primitives, and payment platform. | The WBS safety files, partner money/escrow primitives, and payment platform/adapters are already present. |
| #173–175 | Supabase persistence and canonical email OTP authentication. | Merged history exists. The server identity boundary now also supports Supabase bearer verification without adding a new server-side package dependency. |
| #181 | Legacy runtime-to-AgentRuntime consolidation. GitHub now returns no changed filenames or patch, and its head had collapsed to the base commit. | Exact old diff is unrecoverable through the available PR endpoint. Current AgentRuntime already uses WorkGraph, ExecutionRecord, and VerificationEngine; restored the described `executeTurn()` compatibility contract on the canonical runtime. Exact equivalence to the lost patch is not claimed. |
| #182 | Domain-agnostic auth handoff. No patch/changed-file list is recoverable. | Recovered the provider-neutral intent by adding explicit Supabase bearer verification at the server identity boundary. The original PR's exact implementation remains unrecoverable. |
| #193 | Conflict repair, shared HTTP setup, Wi-Fi configuration/routes, identity boundary, and tests. | Ported the useful HTTP/config/route separation and relevant identity/tests. Did not copy the whole PR or its unrelated core changes. |
| #200 | Architecture-direction gate, explicit framework capability mapping, general-purpose package/README positioning. | Merged and already represented in `main`. |
| #202, #206 | Single-runtime/provider-port consolidation. | Most core pieces are already present: configured provider ports, AgentRuntime execution/streaming, v2 route context, canonical ToolRegistry, task-phase guards, and runtime tests. Continue validating actual boot/call paths; do not infer full consolidation from the module names alone. |
| #207 | Recovery PR containing security/CI/runtime-test patterns. | The PR is closed; its useful patterns have now been ported directly to `main`. Continue work from the current `main` state. |

## Branch findings

- `v0/br3eze-code-22012066` diverged from `main`: one unique commit ahead and 44 commits behind. Its only unique file was `package-lock.json`. That content is now ported to `main` after checking root dependency metadata and shared package versions. The stale ref remains a cleanup candidate.
- The former `refactor/general-purpose-single-runtime` ref disappeared from branch search. It has now been recreated from current `main` as the single working branch for the next audit pass; its starting tree is synchronized with `main`.
- No historical branch should be deleted or rewritten until its unique commits are enumerated and the port is verified.

## Validation status and remaining work

- No full local test/build/lint run has been executed from this connector session.
- The latest reported commit status was a Vercel `failure` linking to the build-rate-limit page; that does not establish a source-code failure or a passing build.
- GitHub workflow-run retrieval returned no PR-triggered runs for the checked main commit. CI is therefore **unverified**, not green.
- Next required checks: `npm ci --ignore-scripts --legacy-peer-deps`, focused server identity/HTTP/Wi-Fi route tests, runtime/domain-boundary tests, `npm run build:check`, `npm run build:types`, and the repository's maintained-code lint/security gates.
- The legacy `src/core/ask-engine.js` still contains hard-coded network, voucher, finance, and printer behavior. The active gateway path uses AgentRuntime, but this legacy module should not be presented as domain-neutral; migrate or retire it only after checking all remaining consumers.
