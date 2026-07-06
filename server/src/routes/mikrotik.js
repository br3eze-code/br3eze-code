/**
 * MikroTik Management Routes
 * Administrative endpoints for router management
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const mikrotikService = require('../services/mikrotikAPI');
const sessionManager = require('../services/sessionManager');
const logger = require('../utils/logger');

// Validation middleware
const validate = (req, res, next) => {
    const errors = require('express-validator').validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
};

/**
 * @route   GET /api/mikrotik/status
 * @desc    Get router status and configuration
 * @access  Admin
 */
router.get('/status', async (req, res) => {
    try {
        const [systemInfo, hotspotConfig, activeSessions] = await Promise.all([
            mikrotikService.getSystemInfo(),
            mikrotikService.getHotspotConfig(),
            mikrotikService.getActiveSessions()
        ]);

        res.json({
            success: true,
            data: {
                system: systemInfo,
                hotspot: hotspotConfig,
                activeSessions: activeSessions.length,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('Get status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve router status'
        });
    }
});

/**
 * @route   GET /api/mikrotik/users
 * @desc    Get all hotspot users
 * @access  Admin
 */
router.get('/users', [
    query('profile').optional().isString(),
    query('search').optional().isString(),
    validate
], async (req, res) => {
    try {
        const filters = {};
        if (req.query.profile) filters.profile = req.query.profile;

        const users = await mikrotikService.getAllUsers(filters);

        // Apply search if provided
        let result = users;
        if (req.query.search) {
            const search = req.query.search.toLowerCase();
            result = users.filter(u =>
                u.name?.toLowerCase().includes(search) ||
                u.comment?.toLowerCase().includes(search)
            );
        }

        res.json({
            success: true,
            count: result.length,
            data: result
        });
    } catch (error) {
        logger.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve users'
        });
    }
});

/**
 * @route   GET /api/mikrotik/users/:username
 * @desc    Get specific user details
 * @access  Admin
 */
router.get('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const [user, stats, session] = await Promise.all([
            mikrotikService.getUser(username),
            mikrotikService.getUserStats(username),
            mikrotikService.getUserSession(username)
        ]);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                ...user,
                stats,
                activeSession: session
            }
        });
    } catch (error) {
        logger.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve user'
        });
    }
});

/**
 * @route   POST /api/mikrotik/users
 * @desc    Create new hotspot user
 * @access  Admin
 */
router.post('/users', [
    body('username').isString().trim().isLength({ min: 3, max: 32 }),
    body('password').isString().isLength({ min: 6 }),
    body('profile').optional().isString(),
    body('macAddress').optional().isMACAddress(),
    body('limitUptime').optional().isString(),
    body('limitBytes').optional().isString(),
    body('rateLimit').optional().isString(),
    validate
], async (req, res) => {
    try {
        const {
            username,
            password,
            profile,
            macAddress,
            limitUptime,
            limitBytes,
            rateLimit
        } = req.body;

        const result = await mikrotikService.createOrUpdateUser(username, password, {
            profile: profile || 'default',
            macAddress,
            limitUptime,
            limitBytesTotal: limitBytes,
            rateLimit,
            comment: `Manual:${new Date().toISOString()}`
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: result
        });
    } catch (error) {
        logger.error('Create user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create user'
        });
    }
});

/**
 * @route   DELETE /api/mikrotik/users/:username
 * @desc    Delete hotspot user
 * @access  Admin
 */
router.delete('/users/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const result = await mikrotikService.deleteUser(username);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        logger.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user'
        });
    }
});

/**
 * @route   POST /api/mikrotik/users/:username/disconnect
 * @desc    Disconnect active user session
 * @access  Admin
 */
router.post('/users/:username/disconnect', async (req, res) => {
    try {
        const { username } = req.params;

        const result = await mikrotikService.disconnectUser(username);

        res.json({
            success: true,
            message: result ? 'User disconnected' : 'No active session found',
            disconnected: result
        });
    } catch (error) {
        logger.error('Disconnect user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect user'
        });
    }
});

/**
 * @route   POST /api/mikrotik/users/:username/rate-limit
 * @desc    Set user bandwidth limit
 * @access  Admin
 */
router.post('/users/:username/rate-limit', [
    body('rateLimit').matches(/^\d+[KMGT]?\/\d+[KMGT]?$/),
    validate
], async (req, res) => {
    try {
        const { username } = req.params;
        const { rateLimit } = req.body;

        await mikrotikService.setRateLimit(username, rateLimit);

        res.json({
            success: true,
            message: `Rate limit set to ${rateLimit}`
        });
    } catch (error) {
        logger.error('Set rate limit error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set rate limit'
        });
    }
});

/**
 * @route   GET /api/mikrotik/sessions
 * @desc    Get all active sessions
 * @access  Admin
 */
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await mikrotikService.getDetailedSessions();

        res.json({
            success: true,
            count: sessions.length,
            data: sessions
        });
    } catch (error) {
        logger.error('Get sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve sessions'
        });
    }
});

/**
 * @route   GET /api/mikrotik/sessions/:id
 * @desc    Get specific session details
 * @access  Admin
 */
router.get('/sessions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sessions = await mikrotikService.getActiveSessions();
        const session = sessions.find(s => s['.id'] === id);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            data: session
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
 * @route   DELETE /api/mikrotik/sessions/:id
 * @desc    Terminate specific session
 * @access  Admin
 */
router.delete('/sessions/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get session info first
        const sessions = await mikrotikService.getActiveSessions();
        const session = sessions.find(s => s['.id'] === id);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Disconnect user
        await mikrotikService.disconnectUser(session.user);

        res.json({
            success: true,
            message: 'Session terminated'
        });
    } catch (error) {
        logger.error('Terminate session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to terminate session'
        });
    }
});

/**
 * @route   GET /api/mikrotik/bandwidth
 * @desc    Get bandwidth usage statistics
 * @access  Admin
 */
router.get('/bandwidth', [
    query('username').optional().isString(),
    validate
], async (req, res) => {
    try {
        const stats = await mikrotikService.getBandwidthStats(req.query.username);

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error('Get bandwidth error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve bandwidth stats'
        });
    }
});

/**
 * @route   GET /api/mikrotik/walled-garden
 * @desc    Get walled garden entries
 * @access  Admin
 */
router.get('/walled-garden', async (req, res) => {
    try {
        const entries = await mikrotikService.getWalledGarden();

        res.json({
            success: true,
            count: entries.length,
            data: entries
        });
    } catch (error) {
        logger.error('Get walled garden error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve walled garden'
        });
    }
});

/**
 * @route   POST /api/mikrotik/walled-garden
 * @desc    Add walled garden entry
 * @access  Admin
 */
router.post('/walled-garden', [
    body('dstHost').optional().isString(),
    body('dstAddress').optional().isIP(),
    body('action').isIn(['allow', 'deny']),
    validate
], async (req, res) => {
    try {
        const { dstHost, dstAddress, action } = req.body;

        const entry = {
            action,
            ...(dstHost && { 'dst-host': dstHost }),
            ...(dstAddress && { 'dst-address': dstAddress })
        };

        const result = await mikrotikService.addWalledGardenEntry(entry);

        res.status(201).json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error('Add walled garden error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add entry'
        });
    }
});

/**
 * @route   DELETE /api/mikrotik/walled-garden/:id
 * @desc    Remove walled garden entry
 * @access  Admin
 */
router.delete('/walled-garden/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await mikrotikService.removeWalledGardenEntry(id);

        res.json({
            success: true,
            message: 'Entry removed'
        });
    } catch (error) {
        logger.error('Remove walled garden error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove entry'
        });
    }
});

/**
 * @route   POST /api/mikrotik/batch-users
 * @desc    Batch create users
 * @access  Admin
 */
router.post('/batch-users', [
    body('users').isArray({ min: 1, max: 100 }),
    body('users.*.username').isString(),
    body('users.*.password').isString(),
    validate
], async (req, res) => {
    try {
        const { users } = req.body;

        const results = await mikrotikService.batchCreateUsers(users);

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            summary: {
                total: users.length,
                successful,
                failed
            },
            results
        });
    } catch (error) {
        logger.error('Batch create error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create users'
        });
    }
});

module.exports = router;