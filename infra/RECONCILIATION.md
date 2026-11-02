# Multi-provider infrastructure reconciliation

Run `npm run infra:plan` for local configuration and credential readiness.
Run `npm run infra:probe` for read-only provider identity checks.
Run `npm run infra:probe -- --json` for machine-readable status.
Pass `--observed path/to/inventory.json` to compare a separately collected remote inventory.

This first implementation is deliberately read-only. Provider identity probes do not prove resource-level synchronization. Provider inventory collectors and approved apply operations are separate follow-on work.

Secrets are never written into inventories or reports. Updates require approval. Remote-only resources are preserved and never deleted.