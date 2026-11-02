# Supabase Auth boundary

Supabase Auth is the single human identity authority for browser, Cordova, native, and API clients. Google is the primary OAuth provider. Other supported OAuth providers are federated by Supabase and produce the same Supabase user/session contract.

## Ownership

- `www/`: starts Supabase Auth flows, stores/refreshes the Supabase session, and sends its access token to APIs.
- `api/` and `src/api/`: API-level authentication adapters verify Supabase access tokens and resolve trusted profile/role data.
- `server/`: verifies Supabase access tokens and enforces domain permissions. It does not implement OAuth callbacks, provider accounts, passwords, or a second human login database.
- Firebase Admin/Firestore: legacy application data only. Firebase ID tokens are not accepted as human API credentials.
- AgentOS service-to-service calls: use the separate `AGENTOS_SERVICE_TOKEN`; never treat a user signing key as a service credential.

## Browser/mobile configuration

Safe client configuration:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_OAUTH_REDIRECT=https://<your-domain>/auth/callback
```

Never expose `SUPABASE_SERVICE_ROLE_KEY`, Google client secrets, or any OAuth provider secret in `www/`, Cordova, or a mobile binary.

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
```

The server verifies user tokens with Supabase Auth's `/auth/v1/user` endpoint. Authorization roles and tenant scope are read only from server-controlled `app_metadata` / protected profile records; client-editable `user_metadata` must never grant roles.

## Migration note

The old server-side Passport/Google + Firebase user-creation route and local SQLite username/password login are retired. Existing Firebase data remains intact, but old Firebase ID tokens and local server JWTs are no longer accepted as human API credentials. Migrate existing users through Supabase Auth account linking/invitation before removing any legacy data.
