# AgentOS production containers

This deployment runs the AgentOS gateway and fleet-health worker as separate restartable services. The gateway serves channel and API traffic. The worker executes bounded, tenant-scoped health polling without routing each health check through CLI intents.

## Build and start

Create a deployment-only `.env` from `.env.example`. Supply real secrets through the deployment platform or a protected environment file; do not commit them.

```bash
docker build --pull -t agentos:production .
docker compose --env-file .env -f docker-compose.production.yml up -d --build
```

Before the first start, apply the PostgreSQL migrations with the project migration runner or an approved migration service. The Compose PostgreSQL init directory is provided for fresh local installations, but production schema changes must be managed by a versioned migration process.

```bash
docker compose --env-file .env -f docker-compose.production.yml ps
docker compose --env-file .env -f docker-compose.production.yml logs -f gateway fleet-worker
```

## Required variables

`AGENTOS_GATEWAY_TOKEN`, `DATABASE_URL`, `REDIS_URL`, `ALLOWED_ORIGINS`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `FLEET_WORKER_PROVIDER_MODULE`, `FLEET_TENANT_IDS`, and `FLEET_WORKER_PRINCIPAL_ID` are required by the production Compose manifest. Provider credentials are optional at image-build time but must be available to the provider module before polling is enabled.

The fleet provider module is intentionally injected rather than hard-coded. It must export:

```js
export async function listTargets({ tenantId, principalId, context }) {}
export async function pollTarget(target, context) {}
export async function saveSnapshot(snapshot) {}
export const notificationHub = null;
export async function close() {}
```

Only `listTargets` and `pollTarget` are mandatory for startup. `saveSnapshot`, `notificationHub`, and `close` are optional. The module must enforce tenant/site/node authorization and use outbound-agent or provider credentials appropriate for each node; it must not trust a tenant or node identifier supplied by a chat transport.

## Runtime topology

The gateway and fleet worker share named volumes for state, data, and logs, but they have separate process lifecycles. PostgreSQL is the durable source for tenant-scoped mesh metadata and Redis is used for distributed caching and coordination. The worker exposes `/healthz` and `/readyz` on its internal port and fails readiness until its first poll succeeds.

The worker defaults to 25 concurrent targets, a 30-second polling interval, a 10-second target timeout, a 30-second lease, and a five-minute alert cooldown. These are operational defaults, not hard-coded policy: override them through the environment after load testing. Scale workers only when the lease and snapshot implementation provide durable duplicate-work protection.

## Security and operations

The image runs as UID/GID 10001, excludes source-control metadata, local state, tests, documentation, credentials, and platform build output from the image context, and receives secrets at runtime. Put TLS termination, rate limiting, and public ingress policy in a managed reverse proxy or load balancer rather than exposing the gateway directly.

Back up PostgreSQL and Redis according to the recovery objective. PostgreSQL backups are mandatory for mesh, tenant, approval, and audit state. Redis persistence is enabled for restart recovery, but Redis must not be treated as the sole source of truth.

## Validation status

The repository passed worker syntax checks, the CI quality gate, two focused Jest suites with five tests, and `git diff --check`. Docker image build and Compose rendering could not be executed in the sandbox because the Docker CLI is not installed. Run both commands in CI or on the deployment host before release.
