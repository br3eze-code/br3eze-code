---
name: test-first-verification
description: Reproduce a bug, add or identify a regression test, implement the smallest fix, and verify that existing behavior remains intact. Use for bug fixes, features, refactors, and suspected regressions.
---

# Test-First Verification

1. Read the relevant implementation, callers, existing tests, package scripts, and CI commands.
2. Establish a baseline: run the narrowest existing test or reproduce the reported failure. Record the observed result.
3. Define expected behavior with explicit inputs, outputs, errors, and important boundary cases.
4. Add a regression test that fails for the reported defect when feasible. Avoid tests that only repeat implementation details.
5. Make the smallest implementation change that satisfies the behavior.
6. Run the focused test, then adjacent tests and relevant repository gates. Use the actual scripts from the checked-out package configuration.
7. Review test quality: meaningful assertions, deterministic setup, cleanup, no reliance on real credentials or production services, and no weakened assertions.
8. If the test cannot be run, state why. Never describe unrun tests as passing.
9. Report the commands and actual outcomes, including skipped or flaky tests and remaining coverage gaps.
