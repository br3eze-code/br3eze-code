---
name: release-verification
description: Verify readiness for a pull request merge, production deployment, or release by checking required CI, build artifacts, configuration, health checks, and rollback considerations. Use before releasing or claiming a deployment is healthy.
---

# Release Verification

1. Confirm the exact commit, branch, target environment, and intended release scope.
2. Inspect required CI checks and their statuses for that exact commit. If statuses are unavailable, mark them unverified.
3. Run applicable syntax, test, type, architecture, security, and production-build checks using existing repository scripts.
4. Check required configuration by variable name and presence only; never print secret values.
5. Verify routing, startup, health/readiness endpoints, migrations, and runtime compatibility where relevant.
6. Confirm deployment targets the intended commit and environment. A successful build is not proof of a healthy production service.
7. Consider rollback/recovery steps and whether the change affects data or external systems.
8. Do not deploy, migrate production data, modify infrastructure, or perform destructive actions without explicit authorization.
9. Report release evidence, unverified checks, known risks, and rollback path. Never label a release “verified” when a required gate is unknown or failing.
