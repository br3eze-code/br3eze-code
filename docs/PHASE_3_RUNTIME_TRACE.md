# Phase 3 — Runtime Trace

Status: **patched on `main`**

## Authority rule

`main` is the only source branch. This phase does not create or depend on feature branches.

The repository currently contains multiple deployment descriptions. They are treated as runtime candidates, not as simultaneously authoritative production paths, until an end-to-end deployment and health check proves otherwise.

## Canonical Phase 3 browser/API path

The intended public fallback URL is:

```text
https://br3eze.africa
```

Runtime configuration follows this rule:

```text
VITE_API_URL
    ↓
configured AgentOS backend URL
    ↓
if not configured → https://br3eze.africa
```

The fallback is used only when `VITE_API_URL` is absent. A configured value is validated as an absolute HTTP(S) URL by the Vercel deployment workflow.

## Evidence-backed runtime paths

### Path A — Vercel

```text
main
  -> .github/workflows/vercel-deploy.yml
  -> npm ci
  -> npm run build
  -> www/
  -> Vercel production
  -> AgentOS API URL
```

Vercel builds the frontend and passes the configured API URL to the application. The Phase 3 fallback is `https://br3eze.africa`.

`vercel.json` declares `api/**/*.js` as Node 22 serverless functions, but a corresponding API implementation is not established by repository evidence. Therefore the Vercel serverless API surface is not treated as authoritative until verified.

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

`apphosting.yaml` defines a Cloud Run service named `agentos` using the GHCR `latest` image and port 3000. The repository's `deploy.yml` does not perform the Cloud Run deployment. Therefore Cloud Run is configured, but its automatic deployment path is not proven.

## Critical runtime finding

The repository currently has four deployment surfaces:

1. Vercel
2. Firebase Hosting + Cloud Functions
3. Kubernetes
4. Cloud Run

This is deployment duplication, not four proven production systems.

The strongest repository-defined browser/API path remains:

```text
Firebase Hosting
    -> /api/**
    -> Firebase HTTPS Function `api`
    -> server/server.js
    -> Firebase/SQLite/external adapters
```

Vercel is the frontend deployment surface, with `VITE_API_URL` selecting the backend and `https://br3eze.africa` as the safe Phase 3 fallback.

Cloud Run and Kubernetes remain container runtime candidates for the long-running AgentOS process.

## Phase 3 decision boundary

Do not delete Firebase, Vercel, Kubernetes, or Cloud Run merely because they overlap.

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

- The Vercel serverless `api/**/*.js` surface is not proven to correspond to the actual backend implementation.
- `firebase.json` clearly maps `/api/**` to the `server` Cloud Function `api`.
- `deploy.yml` builds GHCR and conditionally deploys Kubernetes; it does not deploy the Cloud Run manifest.
- `apphosting.yaml` references a mutable `:latest` GHCR image rather than an immutable digest.
- The container manifest is still heavily domain-specific, which conflicts with the Phase 0 domain-agnostic Core boundary.
- There are multiple independently maintained deployment workflows, so deployment success does not yet imply application runtime success.

## Phase 3 acceptance criteria

Phase 3 is complete only when one production path is demonstrably traceable from `main` to a live health endpoint and application API, with the remaining deployment surfaces explicitly classified as active, secondary, or retired.

No production credentials are committed as part of this phase.
