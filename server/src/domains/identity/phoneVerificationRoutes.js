import {
  requestWhatsAppPhoneOtp,
  verifyWhatsAppPhoneOtp
} from '../../services/phoneOtpService.js';

export function registerPhoneVerificationRoutes({ app, authMiddleware }) {
  if (!app || typeof app.post !== 'function' || typeof authMiddleware !== 'function') {
    throw new TypeError('Phone verification route dependencies are required.');
  }

  app.post('/api/auth/otp/whatsapp/request', authMiddleware, async (req, res) => {
    if (req.user?.provider !== 'supabase' || !req.user?.id) {
      return res.status(401).json({ success: false, code: 'SUPABASE_SESSION_REQUIRED', error: 'A valid account session is required.' });
    }
    try {
      const result = await requestWhatsAppPhoneOtp({
        userId: req.user.id,
        phone: req.body?.phone,
        ip: String(req.ip || ''),
        userAgent: req.get('user-agent') || ''
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      const status = Number(error.status) || 503;
      return res.status(status).json({
        success: false,
        code: error.code || 'OTP_REQUEST_FAILED',
        error: status >= 500 ? 'Unable to send a WhatsApp verification code right now.' : error.message
      });
    }
  });

  app.post('/api/auth/otp/whatsapp/verify', authMiddleware, async (req, res) => {
    if (req.user?.provider !== 'supabase' || !req.user?.id) {
      return res.status(401).json({ success: false, code: 'SUPABASE_SESSION_REQUIRED', error: 'A valid account session is required.' });
    }
    try {
      const result = await verifyWhatsAppPhoneOtp({
        userId: req.user.id,
        challengeId: req.body?.challengeId,
        code: req.body?.code
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      const status = Number(error.status) || 503;
      return res.status(status).json({
        success: false,
        code: error.code || 'OTP_VERIFY_FAILED',
        error: status >= 500 ? 'Phone verification is temporarily unavailable.' : error.message
      });
    }
  });
}
