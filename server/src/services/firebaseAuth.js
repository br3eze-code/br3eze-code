/**
 * Firebase Authentication Service
 * Handles user authentication, token verification, and user management
 */

const { auth, db } = require('../config/firebase');
const logger = require('../utils/logger');
const { generateMikrotikUsername } = require('../utils/crypto');

class FirebaseAuthService {
    /**
     * Verify Firebase ID Token
     * @param {string} idToken - Firebase ID token from client
     * @returns {Promise<Object>} Decoded token with user info
     */
    async verifyIdToken(idToken) {
        try {
            const decodedToken = await auth.verifyIdToken(idToken, true);

            // Check if token is revoked
            if (decodedToken.revoked) {
                throw new Error('Token has been revoked');
            }

            // Get additional user data from Firestore
            const userDoc = await db.collection('users').doc(decodedToken.uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            return {
                uid: decodedToken.uid,
                email: decodedToken.email,
                emailVerified: decodedToken.email_verified,
                displayName: decodedToken.name || userData.displayName,
                photoURL: decodedToken.picture || userData.photoURL,
                phoneNumber: decodedToken.phone_number || userData.phoneNumber,
                customClaims: decodedToken.claims || {},
                mikrotikUsername: generateMikrotikUsername(decodedToken.uid),
                metadata: {
                    creationTime: userData.createdAt,
                    lastSignInTime: userData.lastLoginAt
                }
            };
        } catch (error) {
            logger.error('Token verification failed:', error);
            throw new Error('Invalid authentication token');
        }
    }

    /**
     * Get or create user by email
     * @param {string} email - User email
     * @param {Object} userData - Additional user data
     * @returns {Promise<Object>} User record
     */
    async getOrCreateUser(email, userData = {}) {
        try {
            // Try to get existing user
            let userRecord = await auth.getUserByEmail(email);

            // Update user data if provided
            if (Object.keys(userData).length > 0) {
                userRecord = await auth.updateUser(userRecord.uid, {
                    displayName: userData.displayName || userRecord.displayName,
                    photoURL: userData.photoURL || userRecord.photoURL,
                    phoneNumber: userData.phoneNumber || userRecord.phoneNumber
                });
            }

            return userRecord;
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create new user
                const newUser = await auth.createUser({
                    email,
                    emailVerified: userData.emailVerified || false,
                    displayName: userData.displayName,
                    photoURL: userData.photoURL,
                    phoneNumber: userData.phoneNumber,
                    disabled: false
                });

                // Store additional data in Firestore
                await db.collection('users').doc(newUser.uid).set({
                    email,
                    displayName: userData.displayName || null,
                    photoURL: userData.photoURL || null,
                    phoneNumber: userData.phoneNumber || null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    authProvider: userData.provider || 'email',
                    role: 'user'
                });

                logger.info(`Created new user: ${email}`);
                return newUser;
            }
            throw error;
        }
    }

    /**
     * Create custom token for MikroTik session
     * @param {string} uid - User ID
     * @param {Object} claims - Additional claims
     * @returns {Promise<string>} Custom token
     */
    async createCustomToken(uid, claims = {}) {
        try {
            const customToken = await auth.createCustomToken(uid, {
                ...claims,
                mikrotikAccess: true,
                timestamp: Date.now()
            });
            return customToken;
        } catch (error) {
            logger.error('Custom token creation failed:', error);
            throw error;
        }
    }

    /**
     * Set custom user claims (roles, permissions)
     * @param {string} uid - User ID
     * @param {Object} claims - Claims to set
     */
    async setCustomClaims(uid, claims) {
        try {
            await auth.setCustomUserClaims(uid, claims);

            // Update Firestore for reference
            await db.collection('users').doc(uid).update({
                customClaims: claims,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`Updated claims for user: ${uid}`);
        } catch (error) {
            logger.error('Set custom claims failed:', error);
            throw error;
        }
    }

    /**
     * Revoke all user sessions
     * @param {string} uid - User ID
     */
    async revokeRefreshTokens(uid) {
        try {
            await auth.revokeRefreshTokens(uid);
            logger.info(`Revoked tokens for user: ${uid}`);
        } catch (error) {
            logger.error('Token revocation failed:', error);
            throw error;
        }
    }

    /**
     * Get user by UID
     * @param {string} uid - User ID
     * @returns {Promise<Object>} User record
     */
    async getUser(uid) {
        try {
            return await auth.getUser(uid);
        } catch (error) {
            logger.error(`Get user failed for ${uid}:`, error);
            throw error;
        }
    }

    /**
     * List users with pagination
     * @param {number} maxResults - Maximum results
     * @param {string} pageToken - Pagination token
     * @returns {Promise<Object>} User list
     */
    async listUsers(maxResults = 100, pageToken = null) {
        try {
            const options = { maxResults };
            if (pageToken) options.pageToken = pageToken;

            return await auth.listUsers(options);
        } catch (error) {
            logger.error('List users failed:', error);
            throw error;
        }
    }

    /**
     * Delete user
     * @param {string} uid - User ID
     */
    async deleteUser(uid) {
        try {
            await auth.deleteUser(uid);

            // Clean up Firestore data
            await db.collection('users').doc(uid).delete();

            logger.info(`Deleted user: ${uid}`);
        } catch (error) {
            logger.error(`Delete user failed for ${uid}:`, error);
            throw error;
        }
    }

    /**
     * Verify password reset code
     * @param {string} code - Reset code
     * @returns {Promise<string>} Email address
     */
    async verifyPasswordResetCode(code) {
        try {
            return await auth.verifyPasswordResetCode(code);
        } catch (error) {
            logger.error('Password reset verification failed:', error);
            throw error;
        }
    }

    /**
     * Confirm password reset
     * @param {string} code - Reset code
     * @param {string} newPassword - New password
     */
    async confirmPasswordReset(code, newPassword) {
        try {
            await auth.confirmPasswordReset(code, newPassword);
            logger.info('Password reset confirmed');
        } catch (error) {
            logger.error('Password reset confirmation failed:', error);
            throw error;
        }
    }

    /**
     * Generate password reset link
     * @param {string} email - User email
     * @param {Object} actionCodeSettings - Action settings
     * @returns {Promise<string>} Reset link
     */
    async generatePasswordResetLink(email, actionCodeSettings) {
        try {
            return await auth.generatePasswordResetLink(email, actionCodeSettings);
        } catch (error) {
            logger.error('Generate password reset link failed:', error);
            throw error;
        }
    }

    /**
     * Check if user has active subscription/plan
     * @param {string} uid - User ID
     * @returns {Promise<Object>} Subscription status
     */
    async checkSubscription(uid) {
        try {
            const subscriptions = await db
                .collection('users')
                .doc(uid)
                .collection('subscriptions')
                .where('status', '==', 'active')
                .where('expiresAt', '>', admin.firestore.Timestamp.now())
                .get();

            if (subscriptions.empty) {
                return {
                    hasActiveSubscription: false,
                    plan: null
                };
            }

            const sub = subscriptions.docs[0].data();
            return {
                hasActiveSubscription: true,
                plan: sub.planId,
                expiresAt: sub.expiresAt.toDate(),
                features: sub.features || []
            };
        } catch (error) {
            logger.error(`Check subscription failed for ${uid}:`, error);
            return { hasActiveSubscription: false, plan: null };
        }
    }

    /**
     * Log authentication attempt
     * @param {Object} data - Log data
     */
    async logAuthAttempt(data) {
        try {
            await db.collection('auth_logs').add({
                ...data,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            logger.error('Auth logging failed:', error);
        }
    }

    /**
     * Get user sessions
     * @param {string} uid - User ID
     * @returns {Promise<Array>} Active sessions
     */
    async getUserSessions(uid) {
        try {
            const sessions = await db
                .collection('sessions')
                .where('userId', '==', uid)
                .where('status', '==', 'active')
                .orderBy('createdAt', 'desc')
                .get();

            return sessions.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            logger.error(`Get user sessions failed for ${uid}:`, error);
            return [];
        }
    }

    /**
     * Terminate all user sessions except current
     * @param {string} uid - User ID
     * @param {string} currentSessionId - Session to keep
     */
    async terminateOtherSessions(uid, currentSessionId) {
        try {
            const batch = db.batch();

            const sessions = await db
                .collection('sessions')
                .where('userId', '==', uid)
                .where('status', '==', 'active')
                .get();

            sessions.docs.forEach(doc => {
                if (doc.id !== currentSessionId) {
                    batch.update(doc.ref, {
                        status: 'terminated',
                        terminatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        terminationReason: 'new_session_login'
                    });
                }
            });

            await batch.commit();
            logger.info(`Terminated other sessions for user: ${uid}`);
        } catch (error) {
            logger.error('Terminate sessions failed:', error);
            throw error;
        }
    }
}

module.exports = new FirebaseAuthService();