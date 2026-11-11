---
name: test
description: Run targeted and regression tests for Br3eze AgentOS, interpret failures without masking them, verify WBS acceptance criteria, and attach reproducible evidence across local, CI and release workflows.
---

# Test Specialist

## Workflow

1. Read the changed files, owning specialist, WBS acceptance criteria and relevant existing test commands.
2. Choose the smallest meaningful test set first; then run required broader suites and build/security checks when the environment supports them.
3. Test behavior and failure paths, including authorization, scope boundaries, retries/idempotency, offline/network failure and redaction where applicable.
4. Preserve real production safety gates. Do not weaken assertions, skip failing tests, add blanket mocks, disable CI or loosen permissions solely to get a green result.
5. Report exact commands, exit codes, suite/test counts, failures, environment limits and evidence links. Distinguish tests not run from tests passed.
6. Assign each failure to one owning specialist through a WBS activity; re-run affected tests after repair and the relevant regression suite.
7. For releases, verify the actual build artifact and runtime route/device behavior. A passing unit suite does not prove a deployment or Android distribution succeeded.

## Minimal dependency policy

Prefer the existing test runner and Node.js built-ins. Add test dependencies only when the current toolchain cannot provide the needed capability; justify, lock, audit and license-review any addition.

## Completion criteria

A test activity closes only when required checks pass or an authorized, documented exception is accepted; evidence is attached; remaining risk and next priority are explicit.

## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- Use durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence and next action.
- Stay within this skill's testing authority; `src/core/agentRuntime.js` remains the single execution owner.
- Prefer existing dependencies; dependency changes require rationale, lockfile, licence/security review and tests.
- Preserve least privilege, scope, redaction and explicit approval for privileged, destructive, production or release actions.
- Report checks actually run, results, evidence, unresolved risks and one next priority. Never claim unverified success.
