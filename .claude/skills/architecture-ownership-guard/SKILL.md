---
name: architecture-ownership-guard
description: Check proposed changes for duplicate runtimes, registries, gateways, orchestration loops, API routes, or provider-specific logic leaking into core. Use before architectural refactors or when adding a new service, agent, adapter, registry, or entry point.
---

# Architecture and Ownership Guard

## Invariants
- Keep one accountable execution owner. In this repository, verify the actual live runtime and entry points before naming the owner; do not infer ownership from filenames alone.
- Provider implementations should sit behind stable contracts/adapters when the existing architecture supports that boundary.
- A skill or plugin contributes capability; it must not silently introduce a competing runtime, registry, gateway, or orchestration loop.
- Preserve established API and event contracts unless the task explicitly changes them and includes migration/compatibility coverage.
- Do not assume similarly named files are equivalent or both live.

## Procedure
1. Trace the import/call path from the real executable, route, or caller to the target code.
2. Search for existing implementations, registries, contracts, routes, and tests before creating anything.
3. Identify the authoritative owner, current contract, lifecycle, and error-handling policy; document uncertainty when evidence is incomplete.
4. Prefer extending the existing owner or adapter over creating a parallel subsystem.
5. Check dependency direction and prevent core from depending directly on optional vendors where a contract boundary is appropriate.
6. Run the repository's architecture and boundary gates, plus focused tests.
7. Review the diff for duplicate ownership, cycles, dead code changes, and accidental public-contract changes.
8. Report which owner was preserved, what existing implementation was reused, and which architectural checks actually ran.
