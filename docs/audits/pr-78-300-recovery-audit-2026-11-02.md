# PR recovery audit: #78–#300

Audit date: 2026-11-02  
Repository: `br3eze-code/br3eze-code`  
Audited target: `main` at `ebe73bea2cf4fd68edb80121b3bcaa9c6f579708`

## Scope and evidence

Queried GitHub's complete pull-request listing in ascending creation order for the requested range, then inspected PR metadata, changed-file lists and selected historical head commits against current `main`. A deleted branch is not equivalent to lost work: GitHub still exposes the PR head SHA and file diff while those objects remain retained.

This is a recovery audit, not a claim that every line in every PR was executed or independently tested. A file existing on `main` is evidence of a surviving path, not proof that its implementation is equivalent or production-ready.

## Inventory

| Measure | Count |
| --- | ---: |
| PR records found from #78 through #266 | 177 |
| Merged PRs | 79 |
| Closed without merge | 90 |
| Open PRs | 8 |
| Missing PR numbers inside #78–#266 | 12 |
| PRs numbered #267–#300 | 0 found |

Open PRs at audit time: #239, #240, #241, #242, #243, #261, #262, #263.

There are no PR records for #90–#98, #143, #145 or #171 in this range. No PRs #267–#300 existed in the repository listing at audit time. PR numbering is not a continuous sequence; missing numbers do not mean branches were deleted.

## Deleted-branch recovery: verified outcomes

The following closed/unmerged PRs had recoverable head SHAs or file diffs. Their current-tree status was checked by inspecting the relevant paths on `main`.

| PR | Historical work | Current-main evidence | Disposition |
| --- | --- | --- | --- |
| #87 | Test coverage, auth/vault tests, package scripts and removal of `www_backup` | `tests/unit/agentPolicy.test.js`, `tests/unit/auth.test.js`, and `tests/unit/vault.test.js` are absent. The old AgentPolicy implementation was later replaced by the canonical authorization boundary. | Partially superseded; auth/vault test coverage remains an audit lead, not assumed recovered. Do not restore obsolete AgentPolicy tests unchanged. |
| #88, #135, #147 | Partner platform services, money, ledger, escrow, onboarding, policy and lifecycle tests | `services/partner/**` and `tests/partner/**` exist on `main`; the original `docs/architecture/partner-platform.md` does not. | Core files absorbed; architecture document was not. |
| #121, #129, #148, #167 | A2A task protocol, team orchestration, API and tests | `src/core/a2a-task-protocol.js`, `src/core/agent-team-orchestrator.js` and `tests/a2a-task-wbs.test.js` exist. | Absorbed through later consolidation. |
| #122, #156–#158 | Runtime primitives, capability boundary, supervisor, policy, tracing, framework/protocol adapters and architecture tests | Current tree contains the runtime primitive paths, `AgentSupervisor`, capability boundary and framework/protocol adapters. | Absorbed in later runtime consolidation; original branch must not be merged wholesale. |
| #128, #149, #165 | ACP commerce, checkout, courier, persistence and core-port boundaries | Current tree contains ACP checkout modules, commerce adapters, core ports, and corresponding tests. | Main patterns absorbed and reorganized; compare individual behavior before claiming exact parity. |
| #140–#142, #150–#154, #159–#160, #166 | Domain-agnostic payment provider catalog/registry, Paynow and other provider adapters, orchestration, ledger, reconciliation and persistence | Current tree contains `src/payments/payment-platform.js`, provider registry/catalog, Paynow adapter, ledger, settlement/reconciliation and Supabase persistence. | Absorbed and subsequently evolved. Do not replay historical provider branches. |
| #174 | Canonical commerce persistence and hardened order RPC | Current tree contains the two commerce migrations and persistence adapters named by the PR. | Absorbed at file/path level; database migration application is a separate production change and was not implied by this audit. |
| #181, #182, #184 | Runtime/partner/auth handoff PR records | GitHub returned empty changed-file lists for these PRs. | No recoverable PR file diff from these records; do not infer that a deleted branch contains unique changes. |
| #202, #206, #207–#209 | Single-runtime execution, model-provider port, HITL and delegated agents | Current `src/core/agentRuntime.js`, model adapters, policy/approval paths and tests include later revisions. | Consolidated in later commits; historical branches are not independent runtime owners. |
| #210–#212, #214 | Node classifier, JS LLM lab, autograd and numerical edge-case correction | `src/ml/**`, `experiments/llm-js/**`, `src/llm/autograd.js` and tests exist on `main`. | Absorbed. The #214 corrected autograd path is the intended surviving implementation. |
| #215–#216, #223 | Repository hygiene, file-by-file pattern porting, training/knowledge/hardware work and audit notes | Hygiene gate/tests, training lab, knowledge ingestion, hardware capability adapter and Level 2 platform paths exist. Local settings, environment file, release keystore and logs from the historical branches are absent from the current tree. | Code patterns substantially absorbed; historical audit documents were missing and are archived by this audit. Never restore the local credential/settings artifacts. |
| #218–#222 | Knowledge ingestion, approved-source connectors, Wikimedia adapter and knowledge index | Current tree contains the knowledge ingestion/retrieval modules and Wikimedia import path. | Absorbed and consolidated. |
| #220, #225, #226–#229 | Hardware abstraction, Level 2 portable runtime, service lifecycle and Linux build foundation | Current tree contains hardware capability registry/adapter and the `src/platform/**` runtime foundation. | Absorbed across the later platform/kernel work; do not reintroduce duplicate platform owners. |
| #237, #245 | Deployment workflow and CI root-cause fixes | #245 is a later port of the #237 branch onto then-current main; its PR was merged. | Later port absorbed. Current CI must still pass; historical merge status is not a green check. |
| #264 | Security checks, outbound web/MCP policy and regression tests | `src/core/web-mcp-policy.js` is byte-for-byte identical to the PR head. `scripts/security-check.js`, `src/core/security.js` and its test differ from the historical head. | Partially superseded/evolved; review current security behavior and CI failures rather than replaying old patch. |
| #266 | Supplier provisioning transaction guards and tests | `src/domains/procurement/supplier-provisioning.js` and its test exist on `main`, but both differ from the PR head and are longer. | Absorbed and extended; verify current tests and atomic adapter contract. |

## Important branch-loss findings

1. **A closed PR with no merge SHA is not proof that its work is lost.** Several such PRs have later port commits or equivalent files on `main`.
2. **A deleted branch can still be audited by PR head SHA.** The PR diff and commit objects provide a recovery source while GitHub retains them.
3. **Some work is genuinely absent or only partially represented.** Examples: #87 auth/vault test files and #88 partner architecture documentation. These need a fresh review before any port.
4. **Do not merge stale branches wholesale.** Several historical branches contain competing runtime implementations, provider-specific assumptions, stale lockfiles, or changes already replaced by later code.
5. **Sensitive historical artifacts require special treatment.** PR #215/#216 diffs include a release keystore, local environment file and local AI settings/logs. They are not present in the current tree. Removing them from `main` does not purge Git history or invalidate previously exposed credentials. Review history exposure and rotate affected secrets/signing material as appropriate.

## Prior audit artifacts recovered

Two audit documents were present on historical PR heads but absent from current `main`. They are copied to `docs/audits/archive/` as historical evidence, not as current branch state:

- `branch-pattern-port-ledger-2026-10-31.md` — the earlier file-by-file branch recovery ledger.
- `pr-history-review-2026-10-26.md` — the earlier PR inventory and integration decisions.

The old ledger describes a prior working branch and old comparison counts. It must not be used as the current branch inventory.

## Stability and next actions

- Keep `main` as the only integration owner; do not recreate deleted branches just to make PR numbers look merged.
- For any remaining unabsorbed feature, create a new minimal patch from current `main`, not a resurrected historical branch.
- Revisit #87 auth/vault test intent and #88 partner architecture documentation.
- Re-run CI, security, Helm lint/template, full Node test suite and relevant platform/kernel workflows against the current head.
- Confirm that every production tool call passes through the canonical authorization boundary; file presence alone does not prove end-to-end enforcement.
- Do not apply database migrations or alter production data as part of branch recovery without separate authorization.

## Conclusion

The history does **not** support the claim that all closed branches were lost before absorption. A substantial portion of their unique code is present on `main` through later port/consolidation PRs. It also does **not** support the claim that every PR from #78 to #300 was fully absorbed: there are confirmed partial gaps, historical audit artifacts that were missing, and test/documentation work requiring review.


## Exact branch-deletion trace

GitHub Actions logs show **50 branch refs deleted** by the automated `Prune absorbed branches` workflow across six successful runs on 2026-11-02:

| Workflow run | Deleted refs | Basis |
| --- | ---: | --- |
| `41487021985` | 38 | 37 branches were commit-ancestors of main; one additional branch had an explicit absorption record |
| `41487419654` | 2 | Exact branch-head entries in the absorption manifest |
| `41488092767` | 4 | Exact branch-head entries in the absorption manifest |
| `41489623381` | 2 | Exact branch-head entries in the absorption manifest |
| `41491053106` | 3 | Exact branch-head entries in the absorption manifest |
| `41491425690` | 1 | Exact branch-head entry in the absorption manifest |
| **Total** | **50** | **37 ancestry-verified + 13 explicitly reviewed** |

The PR-related deleted branches included the LLM/Transformer, knowledge, A2A/HITL, partner, payments, Level 2/platform, Linux/kernel, supplier provisioning, security, CI/deployment, persistence and hardware work. The branch names and exact deletion reasons remain in the GitHub Actions logs and the absorption manifest history.

### Two documentation omissions discovered

The explicit file-by-file absorption records for these two branches did not include all historical audit artifacts in the main tree:

- `port/missing-branch-patterns` (PR #216): `docs/audits/branch-pattern-port-ledger.md` was absent from main.
- `refactor/general-purpose-single-runtime` (PR #223): `docs/audits/pr-history-review-2026-10-26.md` was absent from main.

Both documents have now been recovered from their retained PR head commits and archived on main. The feature code was substantially represented, but the original branch cleanup was not a complete file-for-file absorption of those documentation paths.

### Branch-pruner safety gap and correction

The old workflow accepted a non-ancestor branch when the manifest contained only `branch`, `head`, `absorbedIn` and a free-text `reason`. It checked that the head SHA matched and the absorption commit was on main, but did not mechanically require a disposition for every changed file. That is how a branch could be labelled absorbed while an audit document was omitted.

The workflow has now been tightened: non-ancestor deletion requires a `reviewedFiles` inventory that exactly covers the branch's changed paths. Each path must be marked `identical` (verified against main), `superseded` (with a target path present on main and a reason), or `excluded` (with a reason). Existing manifest entries without this inventory are no longer sufficient to authorize future deletion. Fully merged branches remain eligible through commit ancestry.
