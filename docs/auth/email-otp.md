# Email OTP authentication

The canonical browser passwordless login uses Supabase Auth email OTP. Supabase issues the authenticated session after the user verifies the code; the browser never receives a server secret.

The canonical transactional email OTP implementation lives in `api/chat/otp/`.

- POST /api/chat/otp/request
- POST /api/chat/otp/verify

The previous `/api/auth/otp/*` path remains mounted as a compatibility alias for `www/api.php`.

The backend service is intended for email verification and other server-controlled verification workflows. OTP records are stored in public.auth_otp_challenges as a peppered HMAC digest, with a 10-minute default TTL, five attempts, resend cooldown, and daily per-email limits. OTP values are never logged or persisted.

Nodemailer uses a pooled SMTP transporter. Required server environment:

- SMTP_HOST
- SMTP_PORT (default 587)
- SMTP_SECURE (true for implicit TLS; port 465 is treated as secure)
- SMTP_USER
- SMTP_PASS
- EMAIL_FROM
- EMAIL_APP_NAME (optional)
- OTP_PEPPER
- SUPABASE_URL
- SUPABASE_SECRET_KEY (preferred) or legacy SUPABASE_SERVICE_ROLE_KEY

The `server/src/routes/otp.js` and `server/src/services/otpService.js` files are compatibility re-exports only; they do not own OTP logic. The PHP fallback does not implement a second OTP store. www/api.php proxies OTP requests to the canonical Node endpoint using AGENTOS_API_BASE_URL.

Security requirements:

- Keep the Supabase secret key and SMTP credentials server-side only.
- Never put OTPs in logs, localStorage, source control, or API responses.
- Resend creates a new OTP rather than reusing an old one.
- Verification is single-use and locked transactionally in PostgreSQL.


## WhatsApp phone verification

WhatsApp phone verification is part of the same API boundary and requires an existing Supabase bearer session. It verifies ownership of a phone number on an already authenticated account; it does not create or replace a Supabase login session.

- POST `/api/chat/otp/whatsapp/request` with `{ "phone": "+263771234567" }`
- POST `/api/chat/otp/whatsapp/verify` with `{ "challengeId": "...", "code": "123456" }`

The previous `/api/auth/otp/whatsapp/*` paths remain compatibility aliases.

The delivery provider uses Meta WhatsApp Cloud API and an approved WhatsApp **AUTHENTICATION** template with an OTP copy-code button. Configure these server-only variables:

- `WHATSAPP_GRAPH_API_VERSION` (for example, `v26.0`)
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_OTP_TEMPLATE_NAME`
- `WHATSAPP_OTP_TEMPLATE_LANGUAGE` (optional; defaults to `en`)

Phone challenges are stored as peppered HMAC digests in `public.auth_phone_otp_challenges`; the consume RPC enforces expiry, attempt limits and single use, and marks `profiles.phone_verified_at` only after successful verification. The additive migration is `20261102075922_whatsapp_phone_otp.sql`.

Firebase Functions packages the canonical root `api/chat/otp/` source into its deploy directory through `server/scripts/sync-api.mjs`. The same sync runs before standalone server startup and during the Firebase predeploy lint step, so the deployed function does not depend on files outside its package.
