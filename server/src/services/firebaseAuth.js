/**
 * Firebase Authentication Service
 * Canonical user identity and token verification for server-side callers.
 */

import { admin, auth, db } from '../config/firebase.js';
import logger from '../utils/logger.js';
import { generateMikrotikUsername } from '../utils/crypto.js';

const normalizeList = value => Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()) : [];

class FirebaseAuthService {
    async verifyIdToken(idToken) {
        if (typeof idToken !== 'string' || !idToken.trim()) {
            throw new Error('Authentication token required');
        }

        try {
            // checkRevoked=true makes revoked refresh-token sessions fail closed.
            const decodedToken = await auth.verifyIdToken(idToken.trim(), true);
            const uid = decodedToken.uid;
            const userDoc = await db.collection('users').doc(uid).get();
            const userData = userDoc.exists ? userDoc.data() : {};

            // Firebase Admin exposes custom claims directly on the decoded token;
            // there is no guaranteed decodedToken.claims object.
            const customClaims = decodedToken.customClaims && typeof decodedToken.customClaims === 'object'
                ? decodedToken.customClaims
                : {
                    role: decodedToken.role,
                    roles: decodedToken.roles,
                    permissions: decodedToken.permissions
                };

            const roles = normalizeList(customClaims.roles);
            if (typeof customClaims.role === 'string' && customClaims.role.trim()) roles.push(customClaims.role.trim());
            if (typeof userData.role === 'string' && userData.role.trim()) roles.push(userData.role.trim());

            const permissions = [
                ...normalizeList(customClaims.permissions),
                ...normalizeList(userData.permissions)
            ];

            return {
                uid,
                email: decodedToken.email || null,
                emailVerified: decodedToken.email_verified === true,
                displayName: decodedToken.name || userData.displayName || null,
                photoURL: decodedToken.picture || userData.photoURL || null,
                phoneNumber: decodedToken.phone_number || userData.phoneNumber || null,
                provider: decodedToken.firebase?.sign_in_provider || userData.authProvider || null,
                customClaims,
                roles: [...new Set(roles)],
                permissions: [...new Set(permissions)],
                mikrotikUsername: generateMikrotikUsername(uid),
                metadata: {
                    creationTime: userData.createdAt,
                    lastSignInTime: userData.lastLoginAt
                }
            };
        } catch (error) {
            logger.warn('Authentication token rejected', { code: error?.code || 'unknown' });
            throw new Error('Invalid authentication token');
        }
    }

    async getOrCreateUser(email, userData = {}) {
        try {
            let userRecord = await auth.getUserByEmail(email);
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
                const newUser = await auth.createUser({
                    email,
                    emailVerified: userData.emailVerified || false,
                    displayName: userData.displayName,
                    photoURL: userData.photoURL,
                    phoneNumber: userData.phoneNumber,
                    disabled: false
                });

                await db.collection('users').doc(newUser.uid).set({
                    email,
                    displayName: userData.displayName || null,
                    photoURL: userData.photoURL || null,
                    phoneNumber: userData.phoneNumber || null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    authProvider: userData.provider || 'email',
                    role: 'user'
                });
                logger.info('Created new user', { uid: newUser.uid });
                return newUser;
            }
            throw error;
        }
    }

    async createCustomToken(uid, claims = {}) {
        try {
            return await auth.createCustomToken(uid, {
                ...claims,
                mikrotikAccess: true,
                timestamp: Date.now()
            });
        } catch (error) {
            logger.error('Custom token creation failed:', error);
            throw error;
        }
    }

    async setCustomClaims(uid, claims) {
        try {
            await auth.setCustomUserClaims(uid, claims);
            await db.collection('users').doc(uid).update({
                customClaims: claims,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            logger.info('Updated claims for user', { uid });
        } catch (error) {
            logger.error('Set custom claims failed:', error);
            throw error;
        }
    }

    async revokeRefreshTokens(uid) {
        try {
            await auth.revokeRefreshTokens(uid);
            logger.info('Revoked tokens for user', { uid });
        } catch (error) {
            logger.error('Token revocation failed:', error);
            throw error;
        }
    }

    async getUser(uid) {
        try {
            return await auth.getUser(uid);
        } catch (error) {
            logger.error('Get user failed', { uid, error: error?.message });
            throw error;
        }
    }

    async listUsers(maxResults = 100, pageToken = null) {
        try {
            const options = { maxResults };
            if (pageToken) options.pageToken = pageToken;
            return await auth.listUsers(maxResults, pageToken);
        } catch (error) {
            logger.error('List users failed:', error);
            throw error;
        }
    }
}

export default new FirebaseAuthService();
