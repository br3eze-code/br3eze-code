> Historical audit note ported from the Level 3 foundation branch. Its baseline SHA and status reflect the original review date, not current-main verification. Re-run the named checks before using its scores or implementation claims as current facts.

# Level 1 hardware boundary — code quality review

Reviewed: `HardwareCapabilityRegistry`, read-only RouterOS adapter, runtime/gateway composition, and focused tests.

## Findings fixed in this branch

1. **Shared resource ownership:** the RouterOS adapter previously disconnected any injected manager on `close()`. It now disconnects only a manager it constructed itself, so the gateway retains ownership of its shared connection.
2. **In-flight cancellation:** the capability registry previously passed an abort signal but only raced the operation against its timeout. It now rejects promptly when the caller aborts and cleans up signal listeners.
3. **Operation deadline:** timed-out calls reject and signal the adapter. A transport that ignores cancellation can still continue I/O in the background; the RouterOS client path currently has no verified abort integration.
4. **Authorization:** every hardware capability has a namespaced permission and the canonical ToolRegistry still enforces tenant scope, execution task, approval requirements and granted capabilities. Mounting an adapter is not a grant.
5. **Argument boundary:** basic JSON-Schema-like validation rejects malformed object arguments, missing required keys, unexpected keys when disallowed, type/enum/range/length violations before dispatch.
6. **Duplicate declarations:** adapter/capability duplicates are rejected before partial registration.
7. **Regression coverage:** tests cover registry behavior, real ToolRegistry gating, read-only RouterOS delegation, cancellation and timeouts, plus gateway composition.

## Remaining limitations / release blockers

- Unit tests and the complete CI matrix are committed/triggered but have not been confirmed green in this review.
- No live RouterOS device or RouterOS simulator was available in this workflow. The adapter is not yet proven against the installed `routeros-client` version or a real router.
- RouterOS operations currently use a shared manager whose low-level transport does not accept the registry's AbortSignal. A timeout stops waiting and signals cancellation but cannot guarantee the underlying socket operation stopped.
- The argument validator intentionally supports a small schema subset; it is not a complete JSON Schema implementation.
- Hardware permissions must be explicitly granted by trusted host authorization context. Do not add a wildcard grant to make tools appear to work.
- No hardware write capabilities are enabled. Add them only after a simulator/lab test, approval lifecycle test, idempotency plan, and rollback/verification strategy.

## Score

Focused Level 1 boundary quality: **76/100 provisional**.
- Ownership and layering: 18/20
- Authorization and input validation: 18/20
- Cancellation and failure handling: 13/20
- Test quality/evidence: 14/20
- Device integration/release readiness: 13/20

This score rates the Level 1 patch, not the entire AgentOS repository. The whole-project runtime convergence score remains provisional at 69/100 until the parallel execution paths are traced and migrated.
