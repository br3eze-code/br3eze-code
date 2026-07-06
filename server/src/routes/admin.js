/**
 * Webhook Routes
 * Handles MikroTik hotspot events and external integrations
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const crypto = require('crypto');
const { db } = require('../config/firebase');
const mikrotikService = require('../services/mikrotikAPI');
const sessionManager = require('../services/sessionManager');
const logger = require('../utils/logger');
const { verifyWebhookSignature } = require('../utils/crypto');

// Webhook secret for verification
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// Validation middleware
const validate = (req, res, next) => {
    const errors = require('express-validator').validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
};

/**
 * Verify webhook signature
 */
const verifyWebhook = (req, res, next) => {
    if (!WEBHOOK_SECRET) {
        logger.warn('Webhook secret not configured, skipping verification');
        return next();
    }

    const signature = req.headers['x-webhook-signature'];
    if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
    }

    const isValid = verifyWebhookSignature(req.body, signature, WEBHOOK_SECRET);
    if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
};

/**
 * @route   POST /webhooks/hotspot/login
 * @desc    Handle user login event from MikroTik
 * @access  Public (from MikroTik)
 */
router.post('/hotspot/login', [
    body('username').isString(),
    body('mac').isMACAddress(),
    body('ip').isIP(),
    body('sessionId').optional().isString(),
    validate
], async (req, res) => {
    try {
        const { username, mac, ip, sessionId } = req.body;

        logger.info(`Hotspot login: ${username} from ${mac} (${ip})`);

        // Update session if exists
        if (sessionId) {
            await sessionManager.updateSession(sessionId, {
                ipAddress: ip,
                loginTime: new Date(),
                status: 'connected'
            });
        }

        // Log to Firestore
        await db.collection('hotspot_events').add({
            event: 'login',
            username,
            macAddress: mac,
            ipAddress: ip,
            sessionId: sessionId || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update user last login
        const userQuery = await db.collection('users')
            .where('mikrotikUsername', '==', username)
            .limit(1)
            .get();

        if (!userQuery.empty) {
            await userQuery.docs[0].ref.update({
                lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
                lastLoginIp: ip,
                lastLoginMac: mac
            });
        }

        res.json({ success: true, message: 'Login recorded' });
    } catch (error) {
        logger.error('Login webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process login' });
    }
});

/**
 * @route   POST /webhooks/hotspot/logout
 * @desc    Handle user logout event from MikroTik
 * @access  Public (from MikroTik)
 */
router.post('/hotspot/logout', [
    body('username').isString(),
    body('mac').isMACAddress(),
    body('ip').isIP(),
    body('uptime').optional().isString(),
    body('bytesIn').optional().isInt(),
    body('bytesOut').optional().isInt(),
    validate
], async (req, res) => {
    try {
        const { username, mac, ip, uptime, bytesIn, bytesOut } = req.body;

        logger.info(`Hotspot logout: ${username} from ${mac}`);

        // Find and terminate session
        const sessions = await db.collection('sessions')
            .where('mikrotikUsername', '==', username)
            .where('status', 'in', ['active', 'connected'])
            .get();

        const batch = db.batch();
        sessions.docs.forEach(doc => {
            batch.update(doc.ref, {
                status: 'disconnected',
                disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
                stats: {
                    uptime: uptime || '0s',
                    bytesIn: bytesIn || 0,
                    bytesOut: bytesOut || 0
                }
            });
        });
        await batch.commit();

        // Log event
        await db.collection('hotspot_events').add({
            event: 'logout',
            username,
            macAddress: mac,
            ipAddress: ip,
            uptime,
            bytesIn: bytesIn || 0,
            bytesOut: bytesOut || 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update usage statistics
        await db.collection('usage_stats').add({
            username,
            macAddress: mac,
            date: new Date().toISOString().split('T')[0],
            uptime,
            bytesIn: bytesIn || 0,
            bytesOut: bytesOut || 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, message: 'Logout recorded' });
    } catch (error) {
        logger.error('Logout webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process logout' });
    }
});

/**
 * @route   POST /webhooks/hotspot/accounting
 * @desc    Receive interim accounting updates
 * @access  Public (from MikroTik)
 */
router.post('/hotspot/accounting', [
    body('username').isString(),
    body('sessionId').isString(),
    body('uptime').isString(),
    body('bytesIn').isInt(),
    body('bytesOut').isInt(),
    validate
], async (req, res) => {
    try {
        const { username, sessionId, uptime, bytesIn, bytesOut } = req.body;

        // Update session with latest stats
        await sessionManager.updateSession(sessionId, {
            stats: {
                uptime,
                bytesIn,
                bytesOut,
                lastUpdate: new Date()
            }
        });

        // Check limits and alert if needed
        const session = await sessionManager.getSession(sessionId);
        if (session && session.plan === 'guest') {
            const totalBytes = bytesIn + bytesOut;
            const limitBytes = 1073741824; // 1GB in bytes

            if (totalBytes > limitBytes * 0.9) {
                // Near limit - could send notification
                logger.warn(`Guest user ${username} approaching data limit`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Accounting webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process accounting' });
    }
});

/**
 * @route   POST /webhooks/payment/success
 * @desc    Handle successful payment webhook
 * @access  Private (payment processor)
 */
router.post('/payment/success', verifyWebhook, async (req, res) => {
    try {
        const { userId, planId, amount, transactionId } = req.body;

        logger.info(`Payment success: ${userId} - ${planId}`);

        // Update user subscription
        const planDurations = {
            'basic': 30 * 24 * 60 * 60 * 1000, // 30 days
            'premium': 30 * 24 * 60 * 60 * 1000,
            'enterprise': 365 * 24 * 60 * 60 * 1000 // 1 year
        };

        const expiresAt = new Date(Date.now() + (planDurations[planId] || planDurations['basic']));

        await db.collection('users').doc(userId).collection('subscriptions').add({
            planId,
            status: 'active',
            amount,
            transactionId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            features: getPlanFeatures(planId)
        });

        // Update MikroTik user profile if exists
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.mikrotikUsername) {
                await mikrotikService.createOrUpdateUser(userData.mikrotikUsername, null, {
                    profile: planId,
                    rateLimit: getPlanRateLimit(planId)
                });
            }
        }

        res.json({ success: true, message: 'Payment processed' });
    } catch (error) {
        logger.error('Payment webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process payment' });
    }
});

/**
 * @route   POST /webhooks/firebase/user-created
 * @desc    Handle Firebase user creation
 * @access  Private (Firebase)
 */
router.post('/firebase/user-created', async (req, res) => {
    try {
        const { uid, email, displayName } = req.body;

        // Create MikroTik user
        const { generateMikrotikUsername, generateSecurePassword } = require('../utils/crypto');
        const mikrotikUsername = generateMikrotikUsername(uid);
        const mikrotikPassword = generateSecurePassword();

        await mikrotikService.createOrUpdateUser(mikrotikUsername, mikrotikPassword, {
            profile: 'default',
            comment: `Firebase:${email}:${uid}`
        });

        // Store in Firestore
        await db.collection('users').doc(uid).set({
            email,
            displayName: displayName || null,
            mikrotikUsername,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            authProvider: 'firebase'
        });

        res.json({ success: true });
    } catch (error) {
        logger.error('Firebase user creation webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process user creation' });
    }
});

/**
 * @route   POST /webhooks/firebase/user-deleted
 * @desc    Handle Firebase user deletion
 * @access  Private (Firebase)
 */
router.post('/firebase/user-deleted', async (req, res) => {
    try {
        const { uid } = req.body;

        // Get MikroTik username
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();

            // Delete from MikroTik
            if (userData.mikrotikUsername) {
                await mikrotikService.deleteUser(userData.mikrotikUsername);
            }

            // Clean up sessions
            const sessions = await db.collection('sessions')
                .where('userId', '==', uid)
                .get();

            const batch = db.batch();
            sessions.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            // Delete user document
            await userDoc.ref.delete();
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Firebase user deletion webhook error:', error);
        res.status(500).json({ success: false, error: 'Failed to process user deletion' });
    }
});

// Helper functions
function getPlanFeatures(planId) {
    const features = {
        'basic': ['internet_access', 'email_support'],
        'premium': ['internet_access', 'priority_support', 'higher_bandwidth', 'vpn_access'],
        'enterprise': ['internet_access', 'dedicated_support', 'unlimited_bandwidth', 'vpn_access', 'static_ip']
    };
    return features[planId] || features['basic'];
}

function getPlanRateLimit(planId) {
    const limits = {
        'basic': '10M/10M',
        'premium': '50M/50M',
        'enterprise': 'unlimited'
    };
    return limits[planId] || limits['basic'];
}

module.exports = router;