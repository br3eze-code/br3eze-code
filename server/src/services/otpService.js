import crypto from 'crypto';
import { sendOtpEmail } from './emailService.js';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OTP_TTL_SECONDS = Math.max(60, Math.min(900, Number(process.env.OTP_TTL_SECONDS || 600)));
const RESEND_SECONDS = Math.max(30, Math.min(600, Number(process.env.OTP_RESEND_SECONDS || 60)));
const MAX_DAILY_PER_EMAIL = Math.max(3, Math.min(30, Number(process.env.OTP_DAILY_LIMIT || 10)));

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase server credentials are not configured.');
  if (!process.env.OTP_PEPPER) throw new Error('OTP_PEPPER is not configured.');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function digest(value) {
  return crypto.createHmac('sha256', process.env.OTP_PEPPER).update(value).digest('hex');
}

function randomCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

function randomId() {
  return crypto.randomUUID();
}

function restHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...restHeaders(), ...(options.headers || {}) }
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) throw new Error(parsed?.message || parsed?.hint || body || 'Supabase request failed.');
  return parsed;
}

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify(args)
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) throw new Error(parsed?.message || parsed?.hint || body || 'Supabase RPC failed.');
  return parsed;
}

export async function requestOtp({ email, purpose = 'login', ip = '', userAgent = '' }) {
  assertConfig();
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address.'), { status: 400, code: 'INVALID_EMAIL' });
  }
  if (!['login', 'signup', 'email_change', 'password_reset'].includes(purpose)) {
    throw Object.assign(new Error('Invalid OTP purpose.'), { status: 400, code: 'INVALID_PURPOSE' });
  }

  const emailHash = digest(normalized);
  const recent = await rest(
    `auth_otp_challenges?select=id,created_at&email=eq.${encodeURIComponent(normalized)}&purpose=eq.${encodeURIComponent(purpose)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - RESEND_SECONDS * 1000).toISOString())}&order=created_at.desc&limit=1`
  );
  if (recent?.length) {
    throw Object.assign(new Error('Please wait before requesting another code.'), { status: 429, code: 'OTP_COOLDOWN' });
  }

  const today = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const daily = await rest(
    `auth_otp_challenges?select=id&email=eq.${encodeURIComponent(normalized)}&created_at=gte.${encodeURIComponent(today)}&limit=${MAX_DAILY_PER_EMAIL + 1}`
  );
  if ((daily || []).length >= MAX_DAILY_PER_EMAIL) {
    throw Object.assign(new Error('Too many verification requests. Try again later.'), { status: 429, code: 'OTP_DAILY_LIMIT' });
  }

  const code = randomCode();
  const challengeId = randomId();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await rest('auth_otp_challenges', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: challengeId,
      email: normalized,
      purpose,
      otp_hash: digest(`${challengeId}:${normalized}:${code}`),
      expires_at: expiresAt,
      attempts: 0,
      max_attempts: 5,
      requested_ip_hash: ip ? digest(ip) : null,
      user_agent_hash: userAgent ? digest(userAgent) : null
    })
  });

  try {
    await sendOtpEmail({ to: normalized, code, expiresMinutes: Math.ceil(OTP_TTL_SECONDS / 60) });
  } catch (error) {
    await rest(`auth_otp_challenges?id=eq.${encodeURIComponent(challengeId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).catch(() => {});
    throw Object.assign(new Error('Verification email could not be sent.'), { status: 503, code: 'EMAIL_DELIVERY_FAILED' });
  }

  return {
    challengeId,
    expiresIn: OTP_TTL_SECONDS,
    resendIn: RESEND_SECONDS,
    emailHint: normalized.replace(/^(.{2}).*(@.*)$/, '$1••••$2')
  };
}

export async function verifyOtp({ challengeId, code }) {
  assertConfig();
  if (!/^[0-9]{6}$/.test(String(code || ''))) {
    throw Object.assign(new Error('Enter the 6-digit verification code.'), { status: 400, code: 'INVALID_CODE' });
  }

  const rows = await rest(`auth_otp_challenges?id=eq.${encodeURIComponent(challengeId)}&select=id,email,purpose,otp_hash`);
  const challenge = rows?.[0];
  if (!challenge) throw Object.assign(new Error('Invalid or expired verification request.'), { status: 400, code: 'INVALID_CHALLENGE' });

  const expected = digest(`${challenge.id}:${challenge.email}:${code}`);
  const result = await rpc('consume_email_otp', {
    p_challenge_id: challenge.id,
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
    throw Object.assign(new Error(messages[row?.reason] || 'Verification failed.'), { status: 400, code: row?.reason || 'OTP_FAILED' });
  }

  return { verified: true, email: row.email, purpose: row.purpose };
}
