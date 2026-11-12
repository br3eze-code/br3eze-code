---
name: independent-code-review
description: Review a proposed or completed diff for correctness, regressions, security, maintainability, and missing tests independently from the implementation narrative. Use before committing, merging, or declaring a task complete.
---

# Independent Code Review

Review the actual diff and surrounding source, not just the implementer's summary.

## Review order
1. Correctness: incorrect conditions, state transitions, data loss, race conditions, unhandled errors, and edge cases.
2. Compatibility: callers, exported APIs, event formats, persisted data, configuration, Node/module modes, and supported platforms.
3. Security: authorization, validation, command injection, path traversal, secret leakage, unsafe defaults, and permission scope.
4. Architecture: duplicate owners, inappropriate dependency direction, dead-code edits, and vendor-specific logic leaking across boundaries.
5. Tests: missing regression cases, weak assertions, nondeterminism, hidden real-service dependencies, and changed/skipped tests.
6. Operations: logging, retries, timeouts, cleanup, migrations, deployment and rollback behavior.
7. Documentation: instructions or claims that no longer match the code.

## Findings
- Prioritize actionable findings by severity: blocker, high, medium, low.
- For each finding, identify the file and line or exact code path, explain the failure scenario, and recommend a concrete fix.
- Separate confirmed defects from questions and speculative risks.
- If no findings are identified, say “No findings identified in this review”; do not claim the code is defect-free.
- Re-run or request the relevant check for each fixed finding. Review changed tests and workflow gates for attempts to hide failures.
