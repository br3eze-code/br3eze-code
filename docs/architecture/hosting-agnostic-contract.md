# Hosting-agnostic AgentOS contract

## Ownership

The AgentOS harness owns agent identity, scheduling, execution, lifecycle, permissions, IPC, workflow state, checkpoint semantics, audit events and application contracts. Hosting providers do not own or fork those behaviors.

Core exposes a capability-based hosting port at `src/core/ports/hosting.js`. Provider implementations live outside Core and register through the composition root. Core must not import AWS, Firebase, Google Cloud, Vercel, Cloudflare, Supabase, OpenAI or Anthropic SDKs.

## Workload portability

The canonical portable server workload is the OCI image produced by the root Dockerfile. It is the baseline for Docker/Podman, Kubernetes, EKS, ECS, Cloud Run and other OCI-compatible container services. Provider-specific deployment files may package or schedule this same artifact, but must not duplicate harness logic.

Static hosting and backend hosting are different capabilities:
- Vercel and Firebase Hosting currently publish the web client. Their API/function deployments are separate serverless entry points, not proof that the full long-running AgentOS gateway and workers run there.
- Supabase is currently a data/auth service integration, not the AgentOS execution host.
- OpenAI and Anthropic are model providers, not hosting providers.
- Cloudflare has no committed Worker/Pages adapter yet. Workers require an explicit runtime compatibility adapter; do not claim the Node container runs unchanged in the edge runtime.
- Kubernetes/EKS and self-hosted container deployments can host the full Node gateway and workers, subject to persistent storage, queue, network and secrets adapters.

## Portable contracts

Adapters declare capabilities and implement the methods required by those capabilities. Optional platform features are discovered through capabilities, never by checking provider names in Core. The host injects adapters at startup. Credentials stay in provider secret stores or workload identity, never in manifests or source.

Persistence, queue, object storage, secret management, identity, observability and scheduler ports remain separate from hosting. A host may supply implementations, but must not silently become the canonical owner of business state.

## Runtime requirements

The gateway reads `GATEWAY_PORT` or `PORT` and binds to `0.0.0.0` in container deployments. Health checks use `/health`. Stateful data must use a declared durable-storage adapter or an explicitly mounted persistent volume; ephemeral serverless filesystems are not durable.

## Release gates

Every deployment target must pass the same harness contract suite, health/readiness checks, authorization tests, migration compatibility checks and workload smoke tests. Static web deployments run the frontend build only. Full-runtime targets run the OCI gateway image and worker process using the same release digest.

No automatic provider failover is assumed: persistence, queue and identity consistency must be demonstrated before multi-host active/active is enabled.
