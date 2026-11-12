---
name: ci-failure-diagnosis
description: Diagnose GitHub Actions or other CI failures from logs and workflow configuration, identify root causes, patch the underlying issue, and verify the exact failing gate. Use when a workflow is red or a check fails.
---

# CI Failure Diagnosis

1. Inspect the exact workflow file, job, step, event, branch, commit, runtime version, environment variables, and relevant logs.
2. Find the earliest actionable error; distinguish root cause from downstream failures and summary noise.
3. Classify the failure: product defect, test defect, dependency/install, environment/configuration, permissions/secrets, flaky timing, or workflow defect.
4. Reproduce locally when feasible using the same Node version, scripts, environment assumptions, and dependency-install mode. Never expose secret values.
5. Patch the cause, not the symptom. Do not delete tests, broaden ignores, skip checks, make failures non-blocking, or weaken security controls merely to obtain a green result.
6. Run the exact failed command and relevant dependent checks.
7. Inspect the workflow diff for unsafe permissions, unpinned or inappropriate actions, accidental secret logging, and branch/event coverage changes.
8. If CI cannot be triggered or observed from the current environment, say so and provide the commit/PR where it should run. Do not invent a green status.
9. Report the first root cause, fix, reproduction, checks/results, and any remaining uncertainty.
