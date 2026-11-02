import crypto from 'node:crypto';
import { sendWhatsAppOtp } from '../providers/messaging/whatsappCloudProvider.js';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OTP_TTL_SECONDS = Math.max(60, Math.min(900, Number(process.env.OTP_TTL_SECONDS || 600)));
const RESEND_SECONDS = Math.max(30, Math.min(600, Number(process.env.OTP_RESEND_SECONDS || 60)));
const DAILY_LIMIT = Math.max(3, Math.min(30, Number(process.env.OTP_DAILY_LIMIT || 10)));

function fail(message, status = 400, code = 'PHONE_OTP_FAILED') {
  return Object.assign(new Error(message), { status, code });
}

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.OTP_PEPPER) {
    throw fail('Phone verification service is not configured.', 503, 'OTP_NOT_CONFIGURED');
  }
}

function digest(value) {
  return crypto.createHmac('sha256', process.env.OTP_PEPPER).update(value).digest('hex');
}

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\\s().-]/g, '');
  if (/^0[0-9]{9}$/.test(phone)) phone = `+263${phone.slice(1)}`;
  else if (/^263[0-9]{9}$/.test(phone)) phone = `+${phone}`;
  else if (/^[1-9][0-9]{7,14}$/.test(phone)) phone = `+${phone}`;
  if (!/^\\+[1-9][0-9]{7,14}$/.test(phone)) {
    throw fail('Enter a valid phone number with country code, for example +263771234567.', 400, 'INVALID_PHONE');
  }
  return phone;
}

function headers() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) {
    const error = new Error(parsed?.message || parsed?.hint || 'Phone verification storage is unavailable.');
    error.status = response.status >= 500 ? 503 : 400;
    throw error;
  }
  return parsed;
}

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(args)
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) throw fail('Phone verification could not be completed.', 503, 'OTP_STORAGE_FAILED');
  return parsed;
}

export async function requestWhatsAppPhoneOtp({ userId, phone: rawPhone, ip = '', userAgent = '' }) {
  assertConfig();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId || ''))) {
    throw fail('A valid signed-in account is required.', 401, 'AUTH_REQUIRED');
  }
  const phone = normalizePhone(rawPhone);
  const recentSince = new Date(Date.now() - RESEND_SECONDS * 1000).toISOString();
  const recent = await rest(
    `auth_phone_otp_challenges?select=id&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(recentSince)}&consumed_at=is.null&limit=1`
  );
  if (recent?.length) throw fail('Please wait before requesting another code.', 429, 'OTP_COOLDOWN');

  const daySince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const daily = await rest(
    `auth_phone_otp_challenges?select=id&user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(daySince)}&limit=${DAILY_LIMIT + 1}`
  );
  if ((daily || []).length >= DAILY_LIMIT) throw fail('Too many verification requests. Try again later.', 429, 'OTP_DAILY_LIMIT');

  const challengeId = crypto.randomUUID();
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  await rest('auth_phone_otp_challenges', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: challengeId,
      user_id: userId,
      phone,
      purpose: 'phone_verification',
      otp_hash: digest(`${challengeId}:${userId}:${phone}:${code}`),
      expires_at: expiresAt,
      attempts: 0,
      max_attempts: 5,
      requested_ip_hash: ip ? digest(ip) : null,
      user_agent_hash: userAgent ? digest(userAgent) : null
    })
  });

  try {
    await sendWhatsAppOtp({ to: phone, code });
  } catch {
    await rest(`auth_phone_otp_challenges?id=eq.${encodeURIComponent(challengeId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).catch(() => {});
    throw fail('WhatsApp could not deliver the verification code. Check the number or try again later.', 503, 'WHATSAPP_DELIVERY_FAILED');
  }

  return {
    challengeId,
    channel: 'whatsapp',
    expiresIn: OTP_TTL_SECONDS,
    resendIn: RESEND_SECONDS,
    phoneHint: phone.replace(/(\\+\\d{2,3})\\d+(\\d{2})$/, '$1••••••$2')
  };
}

export async function verifyWhatsAppPhoneOtp({ userId, challengeId, code }) {
  assertConfig();
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || ''))) throw fail('Invalid verification request.', 400, 'INVALID_CHALLENGE');
  if (!/^\\d{6}$/.test(String(code || ''))) throw fail('Enter the six-digit verification code.', 400, 'INVALID_CODE');

  const rows = await rest(
    `auth_phone_otp_challenges?id=eq.${encodeURIComponent(challengeId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,phone,user_id`
  );
  const challenge = rows?.[0];
  if (!challenge) throw fail('Invalid or expired verification request.', 400, 'INVALID_CHALLENGE');

  const expected = digest(`${challenge.id}:${challenge.user_id}:${challenge.phone}:${code}`);
  const result = await rpc('consume_phone_otp', {
    p_challenge_id: challenge.id,
    p_user_id: userId,
    p_otp_hash: expected
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (!row?.ok) {
    const messages = {
      expired: 'That code has expired. Request a new one.',
      attempt_limit: 'Too many attempts. Request a new code.',
      already_used: 'That code has already been used.',
      invalid_code: 'Incorrect verification code.'
    };
    throw fail(messages[row?.reason] || 'Verification failed.', 400, row?.reason || 'OTP_FAILED');
  }
  return {
    verified: true,
    phone: row.phone,
    purpose: row.purpose
  };
}
