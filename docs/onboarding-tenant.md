# Onboarding a new tenant (process-per-tenant)

AgentOS's multi-tenancy model for Phase 1 is **process-per-tenant**: every
business owner (router + camera operator) gets their own OS process, own
config directory, and own gateway port. Isolation is the process boundary —
there is no `tenantId` field anywhere in the data model, and this phase does
not add one. A shared-process, request-scoped tenant model (where many
tenants' data lives in one process and every query is filtered by
`tenantId`) is deferred to a future Phase 2, if it's ever needed.

This works today because of two existing, independently-implemented but
consistent mechanisms:
- `main.js`'s `getProfileDir()`
- `src/core/config.js`'s `getProfileDir()` / `ensureProfile()`

Both resolve `AGENTOS_PROFILE=<name>` (or `--dev`) to `~/.agentos-<name>`
(or `~/.agentos` for the default/no-profile case). If you ever see a
profile-path mismatch, check both of these agree — they're two separate
implementations of the same derivation, not one shared function.

## Steps to onboard tenant #2 (or #3, #4, ...)

1. **Pick a profile name.** Use something short and stable, e.g. `tenant2`.
   It becomes part of a directory path (`~/.agentos-tenant2`) and a pm2
   process name, so keep it filesystem- and shell-safe.

2. **Run the onboarding wizard under that profile:**
   ```bash
   AGENTOS_PROFILE=tenant2 node bin/agentos.js onboard
   ```
   This walks through `src/cli/commands/onboard.js` and writes a fresh
   `config.json` under `~/.agentos-tenant2/` — the new tenant's own MikroTik
   router credentials, Dahua camera devices, and a **gateway port that must
   differ** from every other tenant already running (the default profile
   typically uses 19876 — pick something else, e.g. 19877).

3. **Decide the Firebase question up front** (this is a decision, not a
   technical requirement, so make it deliberately):
   - **Shared Firebase project** (simplest): tenant #2's products/orders/
     users live in the same Firestore project as tenant #1, distinguished
     only by which process talks to which router/cameras. No extra setup,
     but no real data isolation beyond "this process only knows about its
     own devices" — tenant #2's admin could theoretically query the same
     Firestore project's data if they had console access.
   - **Dedicated Firebase project**: real data isolation, but more setup —
     a new Firebase project, its own service account, and
     `FIREBASE_PROJECT_ID` / service-account credentials configured per
     profile (e.g. in that profile's `.env` or config).

   For Phase 1, the shared-project option is the pragmatic default unless a
   tenant specifically needs data isolation from day one.

4. **Start the tenant's process**, one pm2 process per tenant, mirroring the
   existing `automate` script's pattern (`package.json`):
   ```bash
   AGENTOS_PROFILE=tenant2 pm2 start bin/agentos.js --name agentos-tenant2 -- gateway
   ```

5. **Point a subdomain/domain at the new process's port.** This is
   reverse-proxy/DNS configuration (nginx, Caddy, etc.) — outside this repo.
   Each tenant typically gets their own subdomain (e.g.
   `tenant2.br3eze.africa`) proxied to `localhost:<their port>`.

6. **Verify independently**: `AGENTOS_PROFILE=tenant2 node bin/agentos.js status`
   should report tenant #2's own router/camera config, completely separate
   from the default profile's.

## What this explicitly does NOT do

- No `tenantId` column, field, or query filter is added anywhere in this
  phase. A tenant's data is scoped entirely by which process it lives in.
- No shared-process routing between tenants — each tenant's Telegram bot,
  WhatsApp session, and gateway are independent processes with independent
  ports and (usually) independent bot tokens.
- If a future need arises for many tenants sharing one process (e.g. cost
  optimization once there are dozens of small tenants), that's a distinct,
  larger piece of work: threading `tenantId` through the ~60 operational
  routes, every Firestore query, and the channel-dispatch layer. Not
  attempted here.
