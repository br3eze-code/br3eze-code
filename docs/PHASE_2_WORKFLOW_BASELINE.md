# AgentOS Phase 2 — Workflow Baseline

**Status:** Patched on `main`
**Canonical repository:** `br3eze-code/br3eze-code`
**Canonical branch:** `main`

## Objective

Phase 2 converts the Phase 1 workflow findings into a single, explicit delivery model without introducing another architecture branch.

## Rules

1. `main` is the only canonical source of product code.
2. Production automation may trigger from `main` only.
3. Preview automation is manual and defaults to `main`.
4. Preview must not silently track a historical feature branch.
5. Vercel configuration is treated as a deployment target configuration, not as permission to commit credentials.
6. Secrets belong in the hosting/CI secret store; `.env` remains local and untracked.
7. No deployment provider is declared authoritative until its end-to-end runtime path is verified.
8. Do not remove Kubernetes, Vercel, Firebase, Cloud Run, or other infrastructure merely because it is currently duplicated; first prove which path is live.

## Workflow map after Phase 2

```text
                         ┌───────────────┐
                         │     main      │
                         │ source of     │
                         │ truth         │
                         └───────┬───────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
              ▼                                     ▼
       Production workflow                    Manual preview
       .github/workflows/                     .github/workflows/
       deploy.yml                             preview-deploy.yml
              │                                     │
              ▼                                     ▼
        GHCR / K8s                         Preview K8s namespace

        Vercel configuration remains available as a separate
        target definition and is not automatically made a second
        production pipeline by this phase.
```

## Environment contract

Vercel variables supplied for deployment are external configuration:

- `VERCEL_TOKEN` — secret; CI/server only.
- `VERCEL_ORG_ID` — deployment configuration.
- `VERCEL_PROJECT_ID` — deployment configuration.
- `VITE_API_URL` — browser-visible API endpoint configuration.
- `VITE_AUTH_DOMAIN` — browser-visible Firebase configuration.
- `VITE_PROJECT_ID` — browser-visible Firebase configuration.
- `VITE_STORAGE_BUCKET` — browser-visible Firebase configuration.
- `VITE_MESSAGING_SENDER_ID` — browser-visible Firebase configuration.
- `VITE_APP_ID` — browser-visible Firebase configuration.
- `SLACK_WEBHOOK_URL` — optional secret; CI/server only.

Values themselves must not be committed to the repository.

## Patch made

`preview-deploy.yml` no longer runs automatically from `upgrade/commerce-domains`. It is now manually dispatched and defaults to `main`. This removes a direct conflict with the main-only development model while preserving preview capability.

## Known remaining decision

`deploy.yml` currently builds and publishes a container to GHCR and can deploy to Kubernetes when `KUBECONFIG` is configured. Its own messaging also references Cloud Run. This is a deployment-target contradiction, not something to guess away. Phase 3 should trace the actual runtime target and make one production path authoritative based on evidence.

## Phase 3 input

Trace the live runtime:

`main → build → artifact → deployment target → gateway/API → frontend → Firebase/persistence → external adapters → health/verification`

No destructive cleanup should occur until that path is proven.
