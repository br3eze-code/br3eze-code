# Supabase migration reconciliation — 2026-11-02

The connected project is `wgybhjqaulxqdfxpouwf`. Remote migration metadata and live catalog state were inspected read-only.

## Verified and aligned

Seven local migration filenames were renamed to the exact remote version/name pairs. The SQL contents were preserved byte-for-byte. This changes repository migration identifiers only; it does not execute SQL or alter the remote migration table.

The two agent-identity migrations were additionally checked against live catalog state: all seven identity tables exist with RLS enabled, and the composite session uniqueness constraint plus tenant-scoped event foreign key exist.

Other aligned migration objects were checked for the expected profiles column/function, canonical payment tables/indexes, and email OTP table/function.

## Still divergent

- Remote-only historical migration records remain. Their SQL source is not present in the repository, so they cannot safely be recreated from names alone.
- The duplicate remote `lock_profile_privileges` record has no second local file. One local migration now matches the first remote version; the duplicate remains unresolved.
- `auth_handoff` remains local-only. The remote project does not contain its table or functions. Its migration now explicitly grants execution to `service_role`, but it is not applied to production.

## Safe next step

Recover missing historical migration source or create a verified schema baseline from the remote database, then reconcile history using the Supabase CLI's migration-repair workflow only after comparing the complete schema. Review and test `auth_handoff` in a disposable local database before a separately approved production migration.

No production DDL, data writes, migration repair, or remote resource deletion was performed.
