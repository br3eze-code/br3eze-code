# Library review — @agentos/runtime

Date: 2026-11-11
Branch: production-hardening-2026-11-11

## What the library is

`src/runtime/` is the portable skill package (`@agentos/runtime`). It defines tools, skills, commerce specialist bundles, and a specialist registry adapter. It is not the production execution owner. That remains `src/core/agentRuntime.js`.

## Findings

| ID | Severity | Finding | Update |
|---|---|---|---|
| LIB-01 | High | `index.js` documented `createRuntime` and a CommonJS `require()`, but that function was never exported. Callers following the file header could not build an agent. | Added `createSkillRuntime` and rewrote the public header as ESM. |
| LIB-02 | Medium | `discoverSkillMetadata` existed in `skill.js` and was not part of the package entry. | Re-exported from `index.js`. |
| LIB-03 | High | A skill runner could execute a matched handler without a mandatory host authorization hook and bypass AgentRuntime's task/approval/audit path. | `createSkillRuntime` now requires both `authorize` and a host-owned `execute` callback, denies on authorization errors, and never invokes tool handlers directly. The host must route execution through the canonical `AgentRuntime`. |
| LIB-04 | Medium | `loadSkillsFrom` uses `createRequire` against skill `index.js` files. ESM-only skills fail the require and silently fall through to a persona-only skill. | Not changed in this commit. Next step: load with `import()` and fail closed when code exists but cannot load. |
| LIB-05 | Low | Package metadata said MIT while the repository license is Apache-2.0. | Package license aligned to Apache-2.0. Version `0.1.1`. |

## Follow-up verification required

- Confirm every production composition root injects the canonical `AgentRuntime` executor and the same permission/tenant authorization boundary.
- Run `npx jest tests/unit/skill-runtime.test.js tests/unit/commerce-approval.test.js --runInBand` after regenerating lockfiles.

## What was not claimed

- This does not merge the runtime into `AgentRuntime`.
- This does not certify tests. Run `npx jest tests/unit/skill-runtime.test.js` on the branch.
- Open contract work still lives on [PR #280](https://github.com/br3eze-code/br3eze-code/pull/280). Absorb that request contract instead of copying it here.
