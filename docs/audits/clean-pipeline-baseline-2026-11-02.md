# Clean Pipeline Baseline

Date: 2026-11-02
Canonical branch: `main`
Baseline commit: `2065fe805fae2c3d92465f19716adac7f0d2cdf9`

## Measured repository state

- 2,388 tracked files in the recursive main tree.
- 60 branch refs including `main`.
- 24 distinct branch-head SHAs.
- 37 branch names point to the exact same commit `9c51352ab00c8916f90a91bd6e58c1f0fa04bcaf`. That commit is behind main and contributes no unique commit relative to main (compare result: 0 ahead, 95 behind). These refs are stale aliases, not 37 independent implementations.
- 11 open pull requests.
- 22 workflow files.

## Changes made

1. Moved architecture and changed-file quality checks into the canonical `.github/workflows/ci.yml` pipeline. It now fetches full history, resolves the PR base or push-before SHA, runs `check:architecture` and `check:ci-quality`.
2. Removed the separate core-boundary invocation from CI because `check:ci-quality` already runs `core-boundary-gate.mjs`. This prevents running the same gate twice.
3. Changed `.github/workflows/quality-gate.yml` to manual-only diagnostics. It no longer runs a second copy of the same checks on every push and PR.

Commits:
- `5bc3993f6335b92d26a0797450ba6fb749f8a6ca` — absorb quality checks into CI
- `c559a31f7fd84c28cfeab4ea36d5b08565525d96` — stop duplicate quality workflow triggers
- `2065fe805fae2c3d92465f19716adac7f0d2cdf9` — remove duplicate core-boundary check

## Deletion and absorption decision

No production source files were deleted in this pass. The current evidence does not identify a defensible exact dead-code deletion count: a 2,388-file tree size is not a dead-code count, and the existing hygiene gate only detects tracked local settings, secrets, logs, and lockfile mistakes. It does not detect unused modules or duplicate implementations.

The 37 same-head branch refs are the strongest cleanup candidates. They must be checked against open PR head refs before deletion. The GitHub connector available in this run supports branch reads and ref updates but does not expose branch deletion, so these refs were not deleted.

Do not delete files solely because a branch contains an older copy. For each unique branch contribution, compare its changed paths with main, then either:
- port the unique implementation and tests into the canonical owner module;
- keep it as a documented experiment if it is intentionally isolated; or
- delete it only after import/reference search, test coverage review, and runtime entry-point verification.

## Remaining blockers to a clean pipeline

- Review the 11 open PRs individually; do not auto-merge dependency majors or security changes without lockfile and test validation.
- Consolidate overlapping deploy/release workflows only after checking their actual target environments and secrets. The 22 workflows include distinct Docker, Firebase, Vercel, OS image, kernel, release, security, dependency, and scheduled automation jobs; file count alone does not prove duplication.
- Add a real unused-code/dependency analysis stage and review its findings manually. Existing gates are not a whole-repository dead-code detector.
- Verify the new CI run on commit `2065fe805fae2c3d92465f19716adac7f0d2cdf9`. At the time of this audit, its CI run was pending; no green result is claimed.

## Acceptance criteria

- Only `main` remains as an active development branch after safe branch cleanup.
- Every retained source file has a known runtime, test, build, migration, or documentation owner.
- Each capability has one canonical implementation; compatibility shims are thin and documented.
- CI runs one required architecture + lint + test pipeline per PR and main push.
- Deployments are separated by target and triggered only by relevant paths, tags, or explicit dispatch.
- The default branch has green required checks and a reproducible clean install.
