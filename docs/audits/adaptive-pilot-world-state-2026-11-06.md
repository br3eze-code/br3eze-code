# Adaptive pilot architecture — first implementation slice

## Purpose

The runtime must distinguish intended state from observed state. An absent observation is **unknown**, and an observation that exceeds its freshness limit is **stale**. Neither may be treated as healthy by default.

## Implemented in this slice

- Added `WorldStateRegistry` as a runtime-scoped observation cache.
- Observations include resource ID, key, value, source, confidence, observation time, record time, freshness limit, and monotonic per-key version.
- Reads return explicit `unknown`, `current`, or `stale` status.
- `requireFresh` fails closed unless an observation is current.
- Values are cloned at the boundary to prevent callers mutating recorded state by reference.
- The canonical `AgentRuntime` owns the registry and exposes observation/query methods; this does not introduce another agent loop.
- State is intentionally volatile. After restart, callers must re-observe rather than infer that old state remains valid.

## Not yet proven

- The registry is not durable storage, device telemetry, or an authorization system.
- Hardware actions do not automatically consume state observations yet. Device adapters and execution paths must explicitly require fresh state before risky actions.
- Multi-source contradiction resolution and atomic state-version checks at the device boundary remain future work.
- Repository tests have been authored but were not run in a checked-out Node.js environment during this patch.

## Acceptance tests

1. Never-observed state is `unknown`.
2. Fresh observations are `current`; expired observations become `stale`.
3. Callers cannot mutate stored observations through returned object references.
4. Invalid provenance, confidence, future timestamps, freshness limits, and capacity overflow are rejected.
5. `requireFresh` throws for unknown or stale state.
6. Full repository CI must pass on the PR revision before merge.

## Next required integration

For each hardware capability that depends on live state, define explicit observation requirements and revalidate them immediately before execution. Where state can change between check and action, use a device-side conditional/version check or a safe equivalent. Never infer successful recovery from tool acceptance alone.
