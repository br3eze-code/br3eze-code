# Branch absorption audit — 2 November 2026

Snapshot: `main` at `4c6b7d97996034f21af5f9ce92a28d81c308f611`, before this audit/workflow commit.

## Inventory

- 60 branches returned by GitHub, including `main`.
- 59 non-main branches.
- 37 branches have zero commits ahead of main and are safe to prune when no unmerged work remains.
- 22 branches initially had unique commit histories. Nine have now been reviewed and explicitly marked absorbed; 13 remain preserved for file-by-file review.
- A file-by-file port does not make a branch's commits ancestors of main. The cleanup workflow therefore supports a reviewed manifest containing the exact branch head and the main commit where the work was absorbed.

## Explicitly absorbed (9)

- `port/nodejs-autograd-current-main`: six commits ahead but no changed files.
- `feat/supplier-provisioning-transaction-guards`: main already contains a newer supplier service and more complete tests.
- `patch/security-hardening-2026-11`: main contains the equivalent Web MCP policy and stronger current security-check implementation.

The additional absorbed branches are `docs/current-main-verification-status`, `docs/readme-evidence-based-status`, `port/security-hygiene-current-main`, `v0/br3eze-code-22012066`, `feat/autonomous-operator-foundation`, and `test/persistence-and-mikrotik-adapter-paths`. Main has newer or byte-identical equivalents; the unique dependency-inventory workflow and test-only storage isolation pattern were ported. All nine exact branch heads are recorded in `.github/branch-absorption.json`; the cleanup workflow deletes them only after verifying the recorded main commit is still an ancestor.

## Ahead branches retained for review

### Dependencies (9)
- `dependabot/npm_and_yarn/babel/core-8.0.9`
- `dependabot/npm_and_yarn/express-5.3.0`
- `dependabot/npm_and_yarn/follow-redirects-1.16.2`
- `dependabot/npm_and_yarn/google-auth-library-11.3.1`
- `dependabot/npm_and_yarn/joi-18.3.1`
- `dependabot/npm_and_yarn/multi-b1658bdecd`
- `dependabot/npm_and_yarn/rate-limiter-flexible-11.2.3`
- `dependabot/npm_and_yarn/server/follow-redirects-1.16.2`
- `dependabot/npm_and_yarn/systeminformation-5.33.19`

Decision: do not replace current lockfiles with snapshots from branches hundreds of commits behind. Reconcile each package update against current manifests, regenerate the lockfile, then run audit and tests.

### Architecture and platform
- `feat/autonomous-operator-foundation`
- `port/missing-branch-patterns`
- `refactor/general-purpose-single-runtime`
- `refactor/linux-single-runtime-boundaries`

Decision: selectively port unique files and patterns only. The general-runtime and missing-patterns branches overlap substantially. The Linux branch contains useful Level-2 service, IPC, app and local-state components, but its platform registry trusts caller-provided `authorizedCapabilities` and `approvalGranted`; its local file-state boundary also needs symlink hardening. Do not merge it wholesale.

### Security and dependency remediation
- `snyk-fix-890df4e8aba327a7453085b9e48a48ee`

Decision: inspect security changes against current main and retain only stronger, non-duplicated protections. The Snyk branch changes Joi without a matching lockfile update; do not merge it as-is.

### Operator, procurement, tests and documentation
- `test/persistence-and-mikrotik-adapter-paths`

Decision: review service contracts and tests before porting; documentation must match current CI evidence. Supplier provisioning still needs a durable store and host composition before it can be enabled.

## Cleanup rules

`.github/workflows/prune-absorbed-branches.yml` deletes a non-main branch only when either:

1. its entire commit history is already an ancestor of `main`; or
2. its exact head SHA is listed in `.github/branch-absorption.json`, and the recorded `absorbedIn` commit is an ancestor of current main.

The workflow closes any matching obsolete open PR before deleting the branch. Ahead branches are not deleted just because they are old. Never force-reset a branch to main to make it appear absorbed.

## Cleanup progress

The first two cleanup workflow runs succeeded and deleted 44 branches (37 fully merged plus seven explicitly absorbed). Two more branches have since been reviewed and added to the explicit absorption manifest. The next main push will trigger the workflow again; the expected remaining inventory is 13 ahead branches plus `main`.
