# Supabase Auth wiring

Supabase Auth is now the canonical browser/mobile authentication path while Firebase remains available to legacy data modules during migration.

## Environment

Server:

```text
SUPABASE_URL=https://wgybhjqaulxqdfxpouwf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only secret>
```

Cordova/browser build (safe to expose):

```text
SUPABASE_URL=https://wgybhjqaulxqdfxpouwf.supabase.co
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_... key>
```

Never put `SUPABASE_SERVICE_ROLE_KEY` in `www/`, a mobile app, or any client bundle.

Run the existing environment generator after setting `.env` so `www/js/env.js` receives only browser-safe keys.

## Protected API

The Node/Vercel API accepts:

```text
Authorization: Bearer <Supabase access token>
```

Protected areas include `/api/tasks`, `/api/a2a`, and `/api/v1/shop`. The API first verifies the token with Supabase Auth, resolves the server-side `profiles` record, and exposes the trusted identity as `req.user` / `req.supabaseUser`. Firebase Bearer tokens remain accepted as a migration fallback.

## Profiles and authorization

`public.profiles` is keyed by `auth.users.id`. A trigger creates a profile after signup. Users can read/update only their own profile through RLS. Roles are constrained to `user`, `admin`, `partner`, and `cashier`; clients cannot promote themselves because role changes are not permitted by the self-update policy.

## Auth redirects

For Google OAuth, configure the production and development callback URLs in Supabase Auth URL Configuration. The Cordova flow currently targets `/auth/callback`; native deep-link handling should be added before shipping OAuth on iOS/Android.

## Current migration boundary

The Cordova authentication surface has moved to Supabase, but legacy Firebase Firestore remains the data source for existing application modules. This is intentional: authentication and authorization are being separated from the legacy domain data migration instead of coupling Supabase into AgentOS core.
