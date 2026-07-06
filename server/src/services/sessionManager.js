/**
 * Session Management Service
 * Handles user sessions, caching, and state management
 */

const NodeCache = require('node-cache');
const { db } = require('../config/firebase');
const logger = require('../utils/logger');
const { generateSessionId } = require('../utils/helpers');

class SessionManager {
    constructor() {
        // In-memory cache for active sessions (TTL: 24 hours)
        this.cache = new NodeCache({
            stdTTL: 86400,
            checkperiod: 600,
            useClones: false
        });

        // Event listeners
        this.cache.on('expired', (key, value) => {
            logger.debug(`Session expired: ${key}`);
            this.handleExpiredSession(key, value);
        });

        this.cache.on('flush', () => {
            logger.info('Session cache flushed');
        });
    }

    /**
     * Create new session
     * @param {Object} sessionData - Session information
     * @returns {Promise<Object>} Created session
     */
    async createSession(sessionData) {
        const sessionId = generateSessionId();
        const timestamp = new Date();

        const session = {
            id: sessionId,
            userId: sessionData.userId,
            username: sessionData.username,
            email: sessionData.email,
            macAddress: sessionData.macAddress,
            ipAddress: sessionData.ipAddress,
            mikrotikUsername: sessionData.mikrotikUsername,
            plan: sessionData.plan || 'default',
            status: 'active',
            createdAt: timestamp,
            lastActivity: timestamp,
            metadata: sessionData.metadata || {}
        };

        // Store in cache
        this.cache.set(sessionId, session);

        // Store in Firestore for persistence
        try {
            await db.collection('sessions').doc(sessionId).set({
                ...session,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastActivity: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            logger.error('Failed to persist session to Firestore:', error);
        }

        logger.info(`Session created: ${sessionId} for user: ${sessionData.username}`);
        return session;
    }

    /**
     * Get session by ID
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object|null>}
     */
    async getSession(sessionId) {
        // Check cache first
        let session = this.cache.get(sessionId);

        if (!session) {
            // Try Firestore
            try {
                const doc = await db.collection('sessions').doc(sessionId).get();
                if (doc.exists) {
                    session = { id: doc.id, ...doc.data() };
                    // Restore to cache
                    this.cache.set(sessionId, session);
                }
            } catch (error) {
                logger.error(`Failed to retrieve session ${sessionId}:`, error);
            }
        }

        return session || null;
    }

    /**
     * Update session activity
     * @param {string} sessionId - Session ID
     * @param {Object} updates - Data to update
     * @returns {Promise<Object>}
     */
    async updateSession(sessionId, updates) {
        const session = await this.getSession(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        const updatedSession = {
            ...session,
            ...updates,
            lastActivity: new Date()
        };

        // Update cache
        this.cache.set(sessionId, updatedSession);

        // Update Firestore (non-blocking)
        db.collection('sessions').doc(sessionId).update({
            ...updates,
            lastActivity: admin.firestore.FieldValue.serverTimestamp()
        }).catch(error => {
            logger.error(`Failed to update session ${sessionId} in Firestore:`, error);
        });

        return updatedSession;
    }

    /**
     * Terminate session
     * @param {string} sessionId - Session ID
     * @param {string} reason - Termination reason
     * @returns {Promise<boolean>}
     */
    async terminateSession(sessionId, reason = 'manual') {
        try {
            const session = await this.getSession(sessionId);
            if (!session) return false;

            const updates = {
                status: 'terminated',
                terminatedAt: new Date(),
                terminationReason: reason
            };

            // Update cache
            this.cache.del(sessionId);

            // Update Firestore
            await db.collection('sessions').doc(sessionId).update({
                ...updates,
                terminatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Log termination
            await db.collection('session_logs').add({
                sessionId,
                userId: session.userId,
                username: session.username,
                action: 'terminated',
                reason,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`Session terminated: ${sessionId}, reason: ${reason}`);
            return true;
        } catch (error) {
            logger.error(`Failed to terminate session ${sessionId}:`, error);
            return false;
        }
    }

    /**
     * Get active sessions for user
     * @param {string} userId - User ID
     * @returns {Promise<Array>}
     */
    async getUserSessions(userId) {
        try {
            const snapshot = await db
                .collection('sessions')
                .where('userId', '==', userId)
                .where('status', '==', 'active')
                .orderBy('createdAt', 'desc')
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            logger.error(`Failed to get sessions for user ${userId}:`, error);
            return [];
        }
    }

    /**
     * Get session by MAC address
     * @param {string} macAddress - MAC address
     * @returns {Promise<Object|null>}
     */
    async getSessionByMac(macAddress) {
        try {
            const normalizedMac = macAddress.toLowerCase();

            // Search in cache first
            const keys = this.cache.keys();
            for (const key of keys) {
                const session = this.cache.get(key);
                if (session?.macAddress?.toLowerCase() === normalizedMac && session.status === 'active') {
                    return session;
                }
            }

            // Search in Firestore
            const snapshot = await db
                .collection('sessions')
                .where('macAddress', '==', normalizedMac)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const session = { id: doc.id, ...doc.data() };
                this.cache.set(doc.id, session);
                return session;
            }

            return null;
        } catch (error) {
            logger.error(`Failed to get session by MAC ${macAddress}:`, error);
            return null;
        }
    }

    /**
     * Handle expired session cleanup
     * @param {string} sessionId - Session ID
     * @param {Object} session - Session data
     */
    async handleExpiredSession(sessionId, session) {
        if (session?.status === 'active') {
            logger.warn(`Session ${sessionId} expired in cache but marked active`);

            // Update Firestore
            try {
                await db.collection('sessions').doc(sessionId).update({
                    status: 'expired',
                    expiredAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                logger.error(`Failed to mark session ${sessionId} as expired:`, error);
            }
        }
    }

    /**
     * Cleanup stale sessions
     * @param {number} maxAgeMinutes - Maximum age in minutes
     * @returns {Promise<number>} Cleaned count
     */
    async cleanupStaleSessions(maxAgeMinutes = 60) {
        try {
            const cutoff = new Date(Date.now() - maxAgeMinutes * 60000);

            const snapshot = await db
                .collection('sessions')
                .where('status', '==', 'active')
                .where('lastActivity', '<', cutoff)
                .get();

            const batch = db.batch();
            let count = 0;

            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    status: 'timed_out',
                    terminatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                this.cache.del(doc.id);
                count++;
            });

            if (count > 0) {
                await batch.commit();
                logger.info(`Cleaned up ${count} stale sessions`);
            }

            return count;
        } catch (error) {
            logger.error('Failed to cleanup stale sessions:', error);
            return 0;
        }
    }

    /**
     * Get session statistics
     * @returns {Promise<Object>}
     */
    async getSessionStats() {
        const cacheKeys = this.cache.keys();
        const activeInCache = cacheKeys.filter(key => {
            const session = this.cache.get(key);
            return session?.status === 'active';
        }).length;

        try {
            const snapshot = await db
                .collection('sessions')
                .where('status', '==', 'active')
                .get();

            return {
                activeInCache,
                activeInDatabase: snapshot.size,
                totalCached: this.cache.getStats().keys
            };
        } catch (error) {
            logger.error('Failed to get session stats:', error);
            return { activeInCache, activeInDatabase: 0, totalCached: 0 };
        }
    }

    /**
     * Invalidate all user sessions
     * @param {string} userId - User ID
     * @param {string} exceptSessionId - Session to keep (optional)
     * @returns {Promise<number>} Number of invalidated sessions
     */
    async invalidateUserSessions(userId, exceptSessionId = null) {
        try {
            const snapshot = await db
                .collection('sessions')
                .where('userId', '==', userId)
                .where('status', '==', 'active')
                .get();

            const batch = db.batch();
            let count = 0;

            snapshot.docs.forEach(doc => {
                if (doc.id !== exceptSessionId) {
                    batch.update(doc.ref, {
                        status: 'invalidated',
                        invalidatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    this.cache.del(doc.id);
                    count++;
                }
            });

            if (count > 0) {
                await batch.commit();
                logger.info(`Invalidated ${count} sessions for user ${userId}`);
            }

            return count;
        } catch (error) {
            logger.error(`Failed to invalidate sessions for user ${userId}:`, error);
            return 0;
        }
    }

    /**
     * Extend session TTL
     * @param {string} sessionId - Session ID
     * @param {number} ttlSeconds - New TTL in seconds
     * @returns {Promise<boolean>}
     */
    async extendSession(sessionId, ttlSeconds = 86400) {
        try {
            const session = this.cache.get(sessionId);
            if (session) {
                this.cache.ttl(sessionId, ttlSeconds);
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Failed to extend session ${sessionId}:`, error);
            return false;
        }
    }
}

module.exports = new SessionManager();