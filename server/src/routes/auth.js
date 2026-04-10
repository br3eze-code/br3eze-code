/**
 * Authentication Routes
 * Handles all authentication endpoints
 */

const express = require('express');
const router = express.Router();
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const firebaseAuthService = require('../services/firebaseAuth');
const mikrotikService = require('../services/mikrotikAPI');
const sessionManager = require('../services/sessionManager');
const logger = require('../utils/logger');
const { generateSecurePassword, generateMikrotikUsername } = require('../utils/crypto');
const { sanitizeMacAddress } = require('../utils/helpers');

// Google OAuth Strategy Setup
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.SERVER_URL}/auth/google/callback`
},
    async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails[0].value;
            const userData = {
                displayName: profile.displayName,
                photoURL: profile.photos[0]?.value,
                emailVerified: profile.emails[0].verified,
                provider: 'google'
            };

            const user = await firebaseAuthService.getOrCreateUser(email, userData);
            done(null, user);
        } catch (error) {
            done(error, null);
        }
    }
));

passport.serializeUser((user, done) => done(null, user.uid));
passport.deserializeUser(async (uid, done) => {
    try {
        const user = await firebaseAuthService.getUser(uid);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

// Validation middleware
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

/**
 * @route   GET /auth/google
 * @desc    Initiate Google OAuth
 * @access  Public
 */
router.get('/google',
    (req, res, next) => {
        // Store session parameters
        req.session.authParams = {
            mac: req.query.mac,
            ip: req.query.ip,
            dst: req.query.dst,
            link: req.query.link,
            apMac: req.query.ap_mac
        };
        next();
    },
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account'
    })
);

/**
 * @route   GET /auth/google/callback
 * @desc    Google OAuth callback
 * @access  Public
 */
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth/error' }),
    async (req, res) => {
        try {
            const params = req.session.authParams || {};
            const firebaseUser = req.user;

            // Generate MikroTik credentials
            const mikrotikUsername = generateMikrotikUsername(firebaseUser.uid);
            const mikrotikPassword = generateSecurePassword();

            // Check subscription/plan
            const subscription = await firebaseAuthService.checkSubscription(firebaseUser.uid);

            // Determine user profile based on subscription
            let profile = 'default';
            let limits = {};

            if (subscription.hasActiveSubscription) {
                profile = subscription.plan;
                // Apply plan-specific limits
                if (subscription.features.includes('premium')) {
                    limits.rateLimit = '50M/50M';
                } else if (subscription.features.includes('basic')) {
                    limits.rateLimit = '10M/10M';
                }
            }

            // Create/update MikroTik user
            await mikrotikService.createOrUpdateUser(mikrotikUsername, mikrotikPassword, {
                profile,
                comment: `Firebase:${firebaseUser.email}:${firebaseUser.uid}`,
                ...limits
            });

            // Create session
            const session = await sessionManager.createSession({
                userId: firebaseUser.uid,
                username: mikrotikUsername,
                email: firebaseUser.email,
                macAddress: sanitizeMacAddress(params.mac),
                ipAddress: params.ip,
                mikrotikUsername,
                plan: subscription.plan || 'default',
                metadata: {
                    authMethod: 'google',
                    dst: params.dst,
                    link: params.link,
                    apMac: params.apMac
                }
            });

            // Log authentication
            await firebaseAuthService.logAuthAttempt({
                userId: firebaseUser.uid,
                email: firebaseUser.email,
                method: 'google',
                macAddress: params.mac,
                ipAddress: params.ip,
                sessionId: session.id,
                success: true
            });

            // Return auto-submit form to MikroTik
            res.send(generateSuccessPage(mikrotikUsername, mikrotikPassword, params.link, params.dst));

        } catch (error) {
            logger.error('Google auth callback error:', error);
            res.redirect('/auth/error?message=authentication_failed');
        }
    }
);

/**
 * @route   POST /auth/email
 * @desc    Email/Password authentication with Firebase
 * @access  Public
 */
router.post('/email', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('mac').optional().isMACAddress(),
    validate
], async (req, res) => {
    try {
        const { email, password, mac, ip, dst, link } = req.body;

        // Note: In production, use Firebase Client SDK to verify password
        // and send ID token to this endpoint for verification
        // This is a simplified version for demonstration

        const user = await firebaseAuthService.getOrCreateUser(email, {
            emailVerified: false,
            provider: 'email'
        });

        // Generate credentials
        const mikrotikUsername = generateMikrotikUsername(user.uid);
        const mikrotikPassword = generateSecurePassword();

        // Create MikroTik user
        await mikrotikService.createOrUpdateUser(mikrotikUsername, mikrotikPassword, {
            profile: 'default',
            comment: `Firebase:${email}:${user.uid}`
        });

        // Create session
        const session = await sessionManager.createSession({
            userId: user.uid,
            username: mikrotikUsername,
            email: user.email,
            macAddress: sanitizeMacAddress(mac),
            ipAddress: ip,
            mikrotikUsername,
            plan: 'default'
        });

        // Log attempt
        await firebaseAuthService.logAuthAttempt({
            userId: user.uid,
            email: user.email,
            method: 'email',
            macAddress: mac,
            ipAddress: ip,
            sessionId: session.id,
            success: true
        });

        res.json({
            success: true,
            username: mikrotikUsername,
            password: mikrotikPassword,
            sessionId: session.id
        });

    } catch (error) {
        logger.error('Email auth error:', error);
        res.status(401).json({
            success: false,
            error: 'Authentication failed'
        });
    }
});

/**
 * @route   POST /auth/verify-token
 * @desc    Verify Firebase ID Token
 * @access  Public
 */
router.post('/verify-token', async (req, res) => {
    try {
        const { idToken, mac, ip } = req.body;

        if (!idToken) {
            return res.status(400).json({
                success: false,
                error: 'ID token required'
            });
        }

        // Verify token
        const decodedUser = await firebaseAuthService.verifyIdToken(idToken);

        // Generate credentials
        const mikrotikPassword = generateSecurePassword();

        // Create/update MikroTik user
        await mikrotikService.createOrUpdateUser(decodedUser.mikrotikUsername, mikrotikPassword, {
            profile: 'default',
            comment: `Firebase:${decodedUser.email}:${decodedUser.uid}`
        });


        // Create session
        const session = await sessionManager.createSession({
            userId: decodedUser.uid,
            username: decodedUser.mikrotikUsername,
            email: decodedUser.email,
            macAddress: sanitizeMacAddress(mac),
            ipAddress: ip,
            mikrotikUsername: decodedUser.mikrotikUsername,
            plan: 'default',
            metadata: {
                authMethod: 'token',
                photoURL: decodedUser.photoURL
            }
        });

        // Log authentication
        await firebaseAuthService.logAuthAttempt({
            userId: decodedUser.uid,
            email: decodedUser.email,
            method: 'token',
            macAddress: mac,
            ipAddress: ip,
            sessionId: session.id,
            success: true
        });

        res.json({
            success: true,
            username: decodedUser.mikrotikUsername,
            password: mikrotikPassword,
            sessionId: session.id,
            user: {
                uid: decodedUser.uid,
                email: decodedUser.email,
                displayName: decodedUser.displayName,
                photoURL: decodedUser.photoURL
            }
        });

    } catch (error) {
        logger.error('Token verification error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token',
            message: error.message
        });
    }
});

/**
 * @route   POST /auth/guest
 * @desc    Create guest access session
 * @access  Public
 */
router.post('/guest', [
    body('mac').isMACAddress(),
    body('ip').optional().isIP(),
    validate
], async (req, res) => {
    try {
        const { mac, ip, apMac } = req.body;
        const sanitizedMac = sanitizeMacAddress(mac);

        // Check for existing guest session
        const existingSession = await sessionManager.getSessionByMac(sanitizedMac);
        if (existingSession && existingSession.plan === 'guest') {
            // Reuse existing guest credentials
            const user = await mikrotikService.getUser(existingSession.username);
            if (user) {
                return res.json({
                    success: true,
                    username: existingSession.username,
                    password: existingSession.metadata.guestPassword,
                    sessionId: existingSession.id,
                    message: 'Existing guest session resumed'
                });
            }
        }

        // Create new guest user in MikroTik
        const guestResult = await mikrotikService.createGuestUser(sanitizedMac, {
            uptime: '2h',
            bytes: '1G',
            rateLimit: '5M/5M'
        });

        // Create session
        const session = await sessionManager.createSession({
            userId: `guest_${sanitizedMac.replace(/:/g, '')}`,
            username: guestResult.username,
            email: null,
            macAddress: sanitizedMac,
            ipAddress: ip,
            mikrotikUsername: guestResult.username,
            plan: 'guest',
            metadata: {
                authMethod: 'guest',
                guestPassword: guestResult.password,
                apMac: apMac,
                limits: {
                    uptime: '2h',
                    bytes: '1G',
                    rateLimit: '5M/5M'
                }
            }
        });

        // Log guest access
        await firebaseAuthService.logAuthAttempt({
            userId: session.userId,
            method: 'guest',
            macAddress: sanitizedMac,
            ipAddress: ip,
            sessionId: session.id,
            success: true
        });

        res.json({
            success: true,
            username: guestResult.username,
            password: guestResult.password,
            sessionId: session.id,
            limits: {
                duration: '2 hours',
                data: '1 GB',
                speed: '5 Mbps'
            }
        });

    } catch (error) {
        logger.error('Guest access error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create guest access'
        });
    }
});

/**
 * @route   POST /auth/refresh
 * @desc    Refresh session
 * @access  Private
 */
router.post('/refresh', async (req, res) => {
    try {
        const { sessionId } = req.body;

        const session = await sessionManager.getSession(sessionId);
        if (!session || session.status !== 'active') {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired session'
            });
        }

        // Extend session
        await sessionManager.extendSession(sessionId, 86400);

        res.json({
            success: true,
            message: 'Session refreshed',
            expiresIn: 86400
        });

    } catch (error) {
        logger.error('Session refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to refresh session'
        });
    }
});

/**
 * @route   POST /auth/logout
 * @desc    Logout and terminate session
 * @access  Public
 */
router.post('/logout', async (req, res) => {
    try {
        const { sessionId, username } = req.body;

        if (sessionId) {
            await sessionManager.terminateSession(sessionId, 'logout');
        }

        if (username) {
            await mikrotikService.disconnectUser(username);
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

/**
 * @route   GET /auth/session/:sessionId
 * @desc    Get session details
 * @access  Public
 */
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await sessionManager.getSession(sessionId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Get real-time stats from MikroTik
        const stats = await mikrotikService.getUserStats(session.mikrotikUsername);

        res.json({
            success: true,
            session: {
                ...session,
                stats
            }
        });

    } catch (error) {
        logger.error('Get session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve session'
        });
    }
});

/**
 * @route   GET /auth/error
 * @desc    Error page for failed authentication
 * @access  Public
 */
router.get('/error', (req, res) => {
    const message = req.query.message || 'Authentication failed';
    res.send(generateErrorPage(message));
});

// Helper: Generate success HTML page
function generateSuccessPage(username, password, link, dst) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .success-icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      animation: scaleIn 0.5s ease;
    }
    .success-icon svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 { color: #333; margin-bottom: 12px; font-size: 24px; }
    p { color: #666; margin-bottom: 24px; line-height: 1.5; }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    .info-box {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 16px;
      margin: 20px 0;
      text-align: left;
      border-radius: 4px;
    }
    .info-box strong { color: #333; }
    .info-box span { color: #666; font-family: monospace; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes scaleIn { 0% { transform: scale(0); } 100% { transform: scale(1); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </div>
    <h1>Authentication Successful!</h1>
    <p>You are being connected to the network...</p>
    <div class="spinner"></div>
    <div class="info-box">
      <strong>Username:</strong> <span>${username}</span><br>
      <strong>Status:</strong> <span>Connecting...</span>
    </div>
  </div>
  
  <form id="loginForm" method="post" action="${link || '/login'}" style="display: none;">
    <input type="hidden" name="username" value="${username}">
    <input type="hidden" name="password" value="${password}">
    <input type="hidden" name="dst" value="${dst || ''}">
  </form>
  
  <script>
    // Auto-submit form after 2 seconds
    setTimeout(() => {
      document.getElementById('loginForm').submit();
    }, 2000);
    
    // Backup: if form doesn't submit, show manual button
    setTimeout(() => {
      document.querySelector('.spinner').style.display = 'none';
      document.querySelector('p').textContent = 'Click below if not redirected automatically:';
      const btn = document.createElement('button');
      btn.textContent = 'Connect to Network';
      btn.style.cssText = 'margin-top: 20px; padding: 12px 24px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px;';
      btn.onclick = () => document.getElementById('loginForm').submit();
      document.querySelector('.container').appendChild(btn);
    }, 5000);
  </script>
</body>
</html>
  `;
}

// Helper: Generate error HTML page
function generateErrorPage(message) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authentication Failed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
      width: 100%;
    }
    .error-icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .error-icon svg {
      width: 40px;
      height: 40px;
      fill: white;
    }
    h1 { color: #333; margin-bottom: 12px; font-size: 24px; }
    p { color: #666; margin-bottom: 24px; line-height: 1.5; }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
    </div>
    <h1>Authentication Failed</h1>
    <p>${message}</p>
    <a href="javascript:history.back()" class="btn">Try Again</a>
  </div>
</body>
</html>
  `;
}

module.exports = router;