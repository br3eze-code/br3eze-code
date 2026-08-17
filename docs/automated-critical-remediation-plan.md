# Automated Critical Dependency and Cordova Remediation Plan

## Current synchronized state

The active checkout is `main`, tracking `origin/main` at `acdb2a24e673db4aa48d80def4e70fed6a96cee3`. The fast-forward-only pull completed with no remote changes. The working tree contains uncommitted AgentOS implementation and documentation changes; the remediation workflow must not reset, clean, stash, or overwrite them automatically.

The latest root audit reports 9 critical findings and 37 high findings. The production-only view reports 8 critical and 34 high findings. These are audit findings, not confirmed incidents. A separate multi-manifest audit is required for Cordova, Android, iOS, Electron, PHP, and packaged desktop surfaces.

## Automation principles

The remediation job must be **dry-run by default**, operate from a clean worktree or an explicit temporary worktree, create one branch per remediation batch, and stop on lockfile drift, test failure, or a newly introduced critical/high finding. It must never run `npm audit fix --force`, remove a platform plugin, rotate credentials, publish an artifact, or deploy without an approval gate.

Every batch produces a manifest containing the starting commit, package-manager version, Node version, affected manifests, audit JSON, proposed changes, test results, rollback commit, and residual exceptions.

## Patch-or-isolate decision algorithm

```text
for each critical/high finding:
  identify manifest, dependency path, runtime surface, and reachability
  if a vendor patch exists and semver-compatible upgrade is available:
    patch the smallest dependency set
  else if a major upgrade exists:
    create an isolated upgrade branch and run adapter/platform tests
  else if the dependency can be removed:
    replace it with a maintained provider-neutral adapter
  else:
    isolate the feature behind a disabled-by-default flag
    restrict tenant/role/channel access
    add process/network/filesystem sandboxing
    record an exception with owner and expiry
  regenerate lockfiles and SBOMs
  run unit, integration, platform, and security regression tests
  run audit again and compare severity/reachability deltas
  require QA and Project Manager approval before merge
```

## Critical remediation batches

| Batch | Findings/surfaces | Preferred action | Isolation fallback | Acceptance gate |
|---|---|---|---|---|
| C-01 Messaging | `form-data` paths and Telegram dependency tree | Upgrade or replace multipart/request path; test Telegram media delivery | Disable media upload, allow text-only messages, restrict outbound hosts | Telegram auth, media, tenant, and SSRF tests |
| C-02 WhatsApp | `@whiskeysockets/baileys` and `libsignal` path | Upgrade Baileys and regenerate authenticated-session fixtures | Disable WhatsApp channel; revoke/rotate session material; keep PWA/Telegram available | Login, pairing, message isolation, replay, and logout tests |
| C-03 Mobile browser | `cordova-plugin-inappbrowser` | Upgrade plugin and Cordova platforms | Disable external navigation; allow only HTTPS hosts on a fixed allowlist | Android/iOS build, URL-scheme, redirect, and injection tests |
| C-04 HTTP runtime | `undici` and related transitive paths | Upgrade to patched version; regenerate lockfile | Restrict outbound destinations and methods; route through hardened HTTP adapter | SSRF, timeout, TLS, redirect, and provider integration tests |
| C-05 Payment | `mastercard-api-core` | Obtain vendor patch or replace with isolated provider adapter | Disable Mastercard operations; leave read-only ledger and other providers available | Signature, idempotency, amount, tenant, and reconciliation tests |
| C-06 Email | `nodemailer` | Upgrade to patched major and test templates | Disable outbound email; queue drafts for manual export | Header injection, template escaping, SMTP policy, and delivery tests |
| C-07 Browser automation | `puppeteer-core` plus browser packages | Upgrade supported Puppeteer/Chromium pair | Disable browser automation; run no untrusted navigation/download | Sandbox, navigation allowlist, download, and process isolation tests |
| C-08 HTML transformation | `html-minifier` | Upgrade or replace with safe parser/minifier | Disable minification for untrusted input; serve prebuilt static output | XSS, template, CSP, and snapshot tests |
| C-09 Platform/plugin transitive set | Cordova plugin manifests, especially networking/device plugins such as `wifi-wizard` | Upgrade/remove affected plugin and regenerate platforms | Remove plugin from release profile; disable native capability and expose a clear UI state | Per-platform SBOM, Android/iOS build, capability, and runtime smoke tests |

The nine batches represent **critical finding clusters**, not a promise that the current audit has exactly nine distinct package names. The audit JSON and dependency paths are authoritative for selecting the exact package versions in each batch.

## Safe automation commands

The following commands are examples for a CI or controlled remediation worker. The worker should run them in a temporary worktree and require explicit approval before applying changes to the developer checkout.

```bash
set -euo pipefail

BASE_SHA="$(git rev-parse HEAD)"
BATCH="security/remediate-critical-$(date -u +%Y%m%d-%H%M%S)"

git status --short
npm audit --json > artifacts/audit-before.json || true
npm ls --all --json > artifacts/tree-before.json || true

# Propose only; do not mutate the checkout.
npm audit fix --dry-run --json > artifacts/audit-fix-proposal.json || true

# Apply a reviewed package group in a temporary branch/worktree only.
git switch -c "$BATCH"
# npm install <approved-package>@<approved-version> --save-exact
npm install --package-lock-only
npm audit --json > artifacts/audit-after.json || true
npm test -- --runInBand
npm run build:check
npm run lint
```

For each batch, a policy check should fail if `critical` increases, if a production critical remains reachable without an exception, if the lockfile is modified outside the declared package group, or if the test/build result is incomplete. The worker should then create a review artifact rather than merge automatically.

## Cordova and cross-platform workflow

Cordova remediation must run separately from the Node root audit:

```bash
cordova platform list
cordova plugin list
cordova requirements
npm audit --json > artifacts/audit-cordova-node.json || true
cordova prepare android
cordova prepare ios
cordova build android
cordova build ios
```

The Android and iOS jobs should use pinned SDK/platform images. A plugin is not considered remediated merely because `package-lock.json` is clean; the generated `platforms/` tree, native Gradle/CocoaPods dependencies, and runtime capability must be audited. Each plugin receives one of three states: `patched`, `removed`, or `isolated-exception`.

For `wifi-wizard` or similar native networking plugins, the default isolation profile should remove the plugin from production builds, disable the associated command, reject requests from non-admin roles, and record `capability_unavailable` without logging credentials or network secrets. Re-enable only after a maintained version, platform build, permission review, and runtime test pass.

## WBS ownership and gates

The Project Manager should seed one WBS package per batch:

| WBS package | Accountable role | Supporting roles | Exit evidence |
|---|---|---|---|
| Dependency inventory and reachability | Security remediation lead | Engineer, QA | Audit JSON, SBOM, runtime-path map |
| Patch or replacement | Engineer | Procurement, Accountant | Reviewed diff, lockfile, provider compatibility |
| Isolation and feature flags | Engineer | Project Manager, Designer | Deny-by-default behavior and UI state |
| Cross-platform rebuild | Engineer | Draftsman, QA | Android/iOS/Electron build logs |
| Security regression | QA | Editor, Secretary | Test report and exception list |
| Release decision | Project Manager | Accountant, Security lead | Approved WBS closure or dated exception |

## Rollback and exception policy

Every batch must be revertible to its starting commit and lockfile. If a patch breaks a provider, the release worker should disable the affected capability and roll back the package group rather than weakening authorization. A residual exception must contain the finding ID, affected versions, reachable path, compensating controls, owner, review date, and automatic expiry. Exceptions older than 30 days should block release until renewed by the Project Manager and Security lead.

## Success criteria

The remediation program is complete only when the root and every platform manifest have been audited, no reachable critical finding remains without an approved temporary exception, high findings have owners and dates, lockfiles are reproducible, Android/iOS/Electron builds pass, and tenant-isolation, approval, payment, channel, CCTV, and provider regression tests are green.
