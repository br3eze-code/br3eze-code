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
| LIB-03 | Medium | The skill runner had no shared fail-closed path. A skill `match()` could select a tool with no host authorization hook. | `createSkillRuntime({ authorize })` denies unless `decision.allowed === true`. With no authorizer, matched tools still run; production hosts should pass `authorize`. |
| LIB-04 | Medium | `loadSkillsFrom` uses `createRequire` against skill `index.js` files. ESM-only skills fail the require and silently fall through to a persona-only skill. | Not changed in this commit. Next step: load with `import()` and fail closed when code exists but cannot load. |
| LIB-05 | Low | Package metadata said MIT while the repository license is Apache-2.0. | Package license aligned to Apache-2.0. Version `0.1.1`. |

## What was not claimed

- This does not merge the runtime into `AgentRuntime`.
- This does not certify tests. Run `npx jest tests/unit/skill-runtime.test.js` on the branch.
- Open contract work still lives on [PR #280](https://github.com/br3eze-code/br3eze-code/pull/280). Absorb that request contract instead of copying it here.
