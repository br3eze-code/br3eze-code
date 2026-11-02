# Supabase Auth boundary

Supabase Auth is the single human identity authority for browser, Cordova, native, and API clients. Google is the primary OAuth provider. Other supported OAuth providers are federated by Supabase and produce the same Supabase user/session contract.

## Ownership

- `www/`: starts Supabase Auth flows, stores/refreshes the Supabase session, and sends its access token to APIs.
- `src/adapters/auth/supabase.js`: the single server-side verifier for Supabase access tokens and the caller's RLS-protected profile.
- `src/api/` and `server/`: share that verifier. `server/scripts/sync-api.mjs` copies the canonical adapter and shared bridge route into the Firebase Functions package before lint/deploy.
- Firebase Auth: downstream data-session compatibility only. After a verified Supabase sign-in, one server route mints a Firebase custom token so existing Firestore rules/data continue to work. Firebase does not authenticate users or protect AgentOS HTTP APIs.
- AgentOS service-to-service calls: use the separate `AGENTOS_SERVICE_TOKEN`; never treat a user signing key as a service credential.

## Browser/mobile configuration

Safe client configuration:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_OAUTH_REDIRECT=https://<your-domain>/auth/callback
```

Never expose `SUPABASE_SERVICE_ROLE_KEY`, Firebase service-account credentials, Google client secrets, or any OAuth provider secret in `www/`, Cordova, or a mobile binary. Firebase Admin may use Google Application Default Credentials in Cloud Functions instead of explicit service-account environment variables.

The current web callback is `/auth/callback`. Configure this exact URL in Supabase Auth URL Configuration and add the app's production/development origins to the redirect allowlist. Native builds require a registered deep-link redirect before enabling OAuth there.

## Configure Google as primary OAuth

1. Create a Google OAuth client in Google Cloud Console.
2. Set its authorized redirect URI to the Supabase project's Google callback URL shown in Supabase Dashboard → Authentication → Providers → Google.
3. Enable Google in Supabase Dashboard → Authentication → Providers and enter the Google client ID and client secret there.
4. Configure the Supabase site URL and allowed redirect URLs to include the Br3eze web callback.
5. Test a fresh Google sign-in, refresh, logout, and a protected API request.

The Google client secret belongs only in Supabase provider configuration. The app redirects to Supabase Auth; it must not exchange Google authorization codes or tokens itself.

## Other OAuth providers

The client exposes the same Supabase Auth flow for `github`, `azure` (Microsoft), `apple`, and `facebook`. Each provider must first be enabled and configured in Supabase Dashboard → Authentication → Providers, including its provider-specific callback URI and secrets. Unsupported/unconfigured providers fail closed.

Email/password and email OTP also use Supabase Auth. WhatsApp phone OTP is a phone-ownership verification feature for an existing Supabase session; it is not a separate login authority.

## Server environment

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
AGENTOS_SERVICE_TOKEN=<separate-long-random-service-token>
FIREBASE_PROJECT_ID=<firebase-project-id>
FIREBASE_PRIVATE_KEY=<server-only-service-account-private-key>
FIREBASE_CLIENT_EMAIL=<server-only-service-account-email>
```

The shared verifier validates access tokens with Supabase Auth's `/auth/v1/user` endpoint, then reads the caller's own profile through RLS. Profile write grants now prevent authenticated users from inserting or changing `role`, `tenant_id`, `site_id`, `domain`, `credits`, and `phone_verified_at`. Only trusted server/service-role workflows can manage those fields. Client-editable `user_metadata` never grants authorization.

## Migration note

The old server-side Passport/Google + Firebase user-creation route and local SQLite username/password login are retired. Existing Firebase data remains intact, but old Firebase ID tokens and local server JWTs are no longer accepted as human API credentials. Migrate existing users through Supabase Auth account linking/invitation before removing any legacy data.


## Firebase legacy data bridge

The Firebase Auth SDK remains loaded only in the main application so it can exchange the server-minted custom token for a Firestore data session. The client never signs in with Firebase Google, email/password, or phone providers. The bridge route `POST /api/auth/firebase-session` requires a valid Supabase access token and a verified Supabase email; it reuses an existing Firebase user with the same verified email or creates a new Firebase data principal. Firebase tokens must not be sent to AgentOS API endpoints.

## Current deployment boundary

The repository changes do not set Google OAuth secrets in the Supabase project. Configure the Google provider in Supabase Dashboard → Authentication → Providers. Configure the Supabase site URL and allow `https://<your-domain>/auth/callback` (the hosting rewrite maps it to `/auth/callback.html`). For the current project, the Google Cloud OAuth redirect URI is `https://wgybhjqaulxqdfxpouwf.supabase.co/auth/v1/callback`. The Supabase allowed redirect URLs must include both `https://br3eze.africa/auth/callback` and `https://www.br3eze.africa/auth/callback`. The Google Cloud redirect URI is the Supabase callback, not the Br3eze callback.


Firestore authorization also reads the server-minted Firebase custom claim `role` that mirrors the protected Supabase profile. Missing claims fail closed to ordinary-user permissions. Firestore user documents are data only and cannot grant admin/partner authority; clients cannot create a user document with a role different from the trusted token claim.
