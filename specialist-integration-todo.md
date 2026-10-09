# Specialist Integration Checklist

**Branch:** `upgrade/commerce-domains` → `main`
**Remote PR refs:** `origin/pr-78` through `origin/pr-125` (plus `origin/pr-99`)
**Last reviewed:** 2026-09-12

## Status

| Task | Status | Notes |
|---|---|---|
| Identify source skill packages | ✅ Done | 11 skill packages in `skills/` dir |
| Copy skills into target branch | ✅ Done | Present on `upgrade/commerce-domains` |
| Wire agent teams to specialist skills | ✅ Done | Commerce domain agents wired in PR #89 / #101 |
| Validate skill structure and routing | ⚠️ Partial | Syntax clean; routing tests missing |
| Jest test suite green | 🔴 Blocked | `jest` binary missing — run `npm ci` |
| Domain isolation validated | 🔴 Blocked | No remove-domain boot test exists yet |
| Merge to `main` | 🔴 Blocked | Waiting on green tests + isolation proof |

## Pending tasks

- [ ] Run `npm ci` at repo root; confirm `npm test` exits 0.
- [ ] Add `"**/tests/**/*.test.mjs"` to `jest.testMatch` in `package.json` so
      `tests/network-adapter.test.mjs` is picked up.
- [ ] Add `tests/integration/domain-isolation.test.js`:
      boot core without `MIKROTIK_*` env vars → no crash.
      boot core without `PAYMENT_PROVIDER` env vars → gateway starts, billing endpoints 503.
- [ ] Confirm each PR (78–125) is rebased onto current `main`.
- [ ] Squash-merge into `main` grouped by domain:
      - [ ] Group A: billing / mobile-money (PRs 78–89)
      - [ ] Group B: commerce / shop (PRs 90–101)
      - [ ] Group C: mesh / network (PRs 102–115)
      - [ ] Group D: security / auth (PRs 116–125)
- [ ] Tag release `v2026.9.0` after all groups land.
