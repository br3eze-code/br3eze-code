---
name: safe-change
description: Coordinate a safe, evidence-based code change from repository inspection through tests, independent diff review, and commit readiness. Use for bug fixes, features, refactors, and any request to commit or push code.
---

# Safe Change Workflow

Use this as the coordinating workflow. Keep one accountable implementation owner; delegate or consult specialist skills only for bounded checks. Do not create a second orchestrator or duplicate the same work across agents.

## 1. Establish repository truth
- Inspect `git status --short --branch`, current branch, `git remote -v`, and the latest commits before editing.
- Fetch remote references before comparing with `main`. Never assume local `main` is current.
- Read the applicable `CLAUDE.md`, package scripts, relevant source, tests, and CI workflow.
- Treat docs as guidance, not proof. If documentation conflicts with executable configuration or the live call path, verify and report the discrepancy before relying on it.
- Preserve unrelated working-tree changes. Never reset, clean, force-push, or overwrite user work as a shortcut.

## 2. Define the smallest safe change
- State the observed failure or requirement, acceptance criteria, affected files, risks, and verification commands.
- Trace the real caller/import/entry point before editing. Avoid changing dead or duplicate implementations unless the task explicitly targets them.
- Prefer a minimal patch over broad refactoring. Do not add dependencies or parallel abstractions without a demonstrated need.
- Ask before destructive, externally visible, production, credential, data-migration, or infrastructure actions when authorization is unclear.

## 3. Implement and verify
- Add or update a focused regression test where practical.
- Run the narrowest relevant test first, then the repository's relevant lint, build, architecture, security, and CI checks.
- Use the actual package scripts and workflow in the checked-out revision. Do not invent commands.
- If a check fails, inspect the first actionable failure, fix the cause, and rerun the failed check. Do not silence, skip, or weaken a test merely to get green.
- If a check cannot run, report the exact blocker and mark it unverified.

## 4. Review the final diff
- Inspect `git diff --check`, `git diff --stat`, and the full diff.
- Check for unrelated files, accidental generated output, secrets, unsafe commands, changed public contracts, missing tests, and inconsistent documentation.
- Verify that each acceptance criterion has evidence.
- Do not claim a build, test, CI run, deployment, or integration succeeded unless its result was observed.

## 5. Commit and push safely
- Before staging, inspect status and stage only files belonging to this task.
- Use a descriptive, scoped commit message.
- Recheck the staged diff before committing.
- Prefer a feature branch and pull request. Push only to the intended branch after local checks pass. Do not push directly to protected `main` or force-push unless the user explicitly authorizes the specific action and repository policy allows it.
- After push, report the commit SHA, changed files, checks run and results, remaining risks, and PR URL if created.

## Stop conditions
Stop and report rather than guessing when the base branch is unclear, the working tree contains risky unrelated changes, a required test fails without a safe fix, credentials or production access are missing, or the requested change conflicts with established ownership boundaries.
