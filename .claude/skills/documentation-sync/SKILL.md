---
name: documentation-sync
description: Keep repository instructions, READMEs, architecture decisions, setup guides, and skill docs aligned with the code actually implemented. Use when code changes affect documented behavior or when documentation is stale or contradictory.
---

# Documentation Synchronization

1. Identify which user-facing behavior, developer workflow, configuration, public contract, or architecture decision changed.
2. Read existing docs and verify claims against source code, package metadata, scripts, tests, and workflows.
3. Make targeted edits to the canonical document; avoid creating overlapping sources of truth.
4. Label proposed or unverified behavior as planned, not implemented. Distinguish mocked tests from live integration results.
5. Preserve existing terminology unless the implementation intentionally changes it.
6. Include accurate commands and paths. Verify commands against the checked-out package/workflow.
7. Check internal links and consistency across relevant docs.
8. Review the final documentation diff for unsupported claims, stale examples, secret exposure, and unnecessary duplication.
