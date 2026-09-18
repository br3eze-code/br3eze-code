import express from 'express';
import { requestOtp, verifyOtp } from '../services/otpService.js';

const router = express.Router();

const buckets = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 20;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

function allowIp(ip) {
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    buckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (entry.count >= MAX_PER_IP) return false;
  entry.count += 1;
  return true;
}

router.post('/request', async (req, res) => {
  const ip = clientIp(req);
  if (!allowIp(ip)) return res.status(429).json({ success: false, code: 'RATE_LIMITED', error: 'Too many requests. Try again later.' });

  try {
    const result = await requestOtp({
      email: req.body?.email,
      purpose: req.body?.purpose || 'login',
      ip,
      userAgent: req.get('user-agent') || ''
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      success: false,
      code: error.code || 'OTP_REQUEST_FAILED',
      error: status >= 500 ? 'Unable to send a verification code right now.' : error.message
    });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const result = await verifyOtp({
      challengeId: req.body?.challengeId,
      code: req.body?.code
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      success: false,
      code: error.code || 'OTP_VERIFY_FAILED',
      error: status >= 500 ? 'Verification is temporarily unavailable.' : error.message
    });
  }
});

export default router;
