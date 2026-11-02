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
