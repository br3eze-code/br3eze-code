import { registerPhoneVerificationRoutes } from './phone/routes.js';

export function registerOtpRoutes({ app, emailRouter, authMiddleware }) {
  if (!app || typeof app.use !== 'function' || !emailRouter ||
      typeof authMiddleware !== 'function') {
    throw new TypeError('OTP route dependencies are required.');
  }

  app.use('/api/chat/otp', emailRouter);
  // Preserve the old PHP bridge while clients migrate to /api/chat/otp.
  app.use('/api/auth/otp', emailRouter);
  registerPhoneVerificationRoutes({ app, authMiddleware });
}
