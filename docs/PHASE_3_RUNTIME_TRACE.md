# Phase 3 — Runtime Trace

Status: **traced on `main`**

## Authority rule

`main` is the only source branch. This phase does not create or depend on feature branches.

The repository currently contains multiple deployment descriptions. They are treated as **runtime candidates**, not as simultaneously authoritative production paths, until an end-to-end deployment and health check proves otherwise.

## Evidence-backed runtime paths

### Path A — Vercel

```text
main
  -> .github/workflows/vercel-deploy.yml
  -> npm ci
  -> npm run build
  -> www/
  -> Vercel production
```

`vercel.json` also declares `api/**/*.js` as Node 22 serverless functions. The repository trace did not establish a corresponding `api/` implementation, so Vercel API execution is **not proven** by repository evidence.

### Path B — Firebase Hosting + Functions

```text
main
  -> Release workflow
  -> firebase-deploy.yml
  -> firebase.json
      -> www/ (Hosting)
      -> server/ (Cloud Function: api)
      -> Firestore rules/indexes
```

This is a complete repository-defined frontend/API path. `server/index.js` exports the `api` HTTPS function and `firebase.json` rewrites `/api/**` to that function.

### Path C — Container + Kubernetes

```text
main
  -> deploy.yml
  -> Docker build
  -> GHCR image
  -> Kubernetes/Helm (only when KUBECONFIG exists)
```

The workflow can build and publish the container on qualifying changes. Kubernetes deployment is conditional on `KUBECONFIG` being configured.

### Path D — Container + Cloud Run

```text
main
  -> Docker build
  -> GHCR image
  -> apphosting.yaml
  -> Cloud Run (manual/externally invoked today)
```

`apphosting.yaml` defines a Cloud Run service named `agentos` using the GHCR `latest` image and port 3000. The repository's `deploy.yml` does **not** perform the Cloud Run deployment. Therefore Cloud Run is configured, but its automatic deployment path is not proven.

## Critical runtime finding

The repository currently has **four deployment surfaces**:

1. Vercel
2. Firebase Hosting + Cloud Functions
3. Kubernetes
4. Cloud Run

This is deployment duplication, not four proven production systems.

The most internally complete browser/API path is currently:

```text
Firebase Hosting
    -> /api/**
    -> Firebase HTTPS Function `api`
    -> server/server.js
    -> Firebase/SQLite/external adapters
```

Vercel is independently configured for the same `www` output, but its declared serverless `api/**/*.js` surface has not been proven to correspond to the actual backend implementation.

Cloud Run and Kubernetes are container runtime candidates for the long-running AgentOS process.

## Phase 3 decision boundary

Do **not** delete Firebase, Vercel, Kubernetes, or Cloud Run merely because they overlap.

Before consolidating, prove the production request path:

```text
public domain
  -> DNS / hosting target
  -> frontend
  -> API endpoint
  -> authentication
  -> persistence
  -> domain adapter
  -> health endpoint
```

The authoritative production target must be selected from evidence, not from whichever deployment file looks newest.

## Known blockers

- `vercel.json` declares `api/**/*.js`, but an `api/` implementation was not established in the Phase 3 repository trace.
- `firebase.json` clearly maps `/api/**` to the `server` Cloud Function `api`.
- `deploy.yml` builds GHCR and conditionally deploys Kubernetes; it does not deploy the Cloud Run manifest.
- `apphosting.yaml` references a mutable `:latest` GHCR image rather than an immutable digest.
- The container manifest is still heavily domain-specific (MikroTik, hotspot billing, PayNow, Mastercard, Telegram, AWS), which conflicts with the Phase 0 domain-agnostic Core boundary.
- There are multiple independently maintained deployment workflows, so deployment success does not yet imply application runtime success.

## Phase 3 acceptance criteria

Phase 3 is complete only when one production path is demonstrably traceable from `main` to a live health endpoint and application API, with the remaining deployment surfaces explicitly classified as active, secondary, or retired.

No production credentials are committed as part of this phase.
