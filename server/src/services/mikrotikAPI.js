/**
 * MikroTik API Service
 * Handles all communication with MikroTik routers
 */

const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');
const config = require('../config/mikrotik');
const { retryWithBackoff } = require('../utils/helpers');

class MikroTikAPI {
    constructor() {
        this.baseURL = config.restApi.baseUrl;
        this.auth = {
            username: config.restApi.user,
            password: config.restApi.password
        };

        // Create axios instance with SSL handling
        this.client = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: config.restApi.rejectUnauthorized
            }),
            auth: this.auth,
            timeout: config.primary.timeout,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Request/Response interceptors for logging
        this.client.interceptors.request.use(
            (config) => {
                logger.debug(`MikroTik API Request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                logger.error('MikroTik API Request Error:', error);
                return Promise.reject(error);
            }
        );

        this.client.interceptors.response.use(
            (response) => {
                logger.debug(`MikroTik API Response: ${response.status}`);
                return response;
            },
            (error) => {
                logger.error('MikroTik API Error:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Test connection to MikroTik
     * @returns {Promise<boolean>}
     */
    async testConnection() {
        try {
            await this.client.get(`${this.baseURL}/system/resource`);
            return true;
        } catch (error) {
            logger.error('MikroTik connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Get system resources/info
     * @returns {Promise<Object>}
     */
    async getSystemInfo() {
        return retryWithBackoff(async () => {
            const response = await this.client.get(`${this.baseURL}/system/resource`);
            return response.data;
        });
    }

    /**
     * Create or update hotspot user
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {Object} options - User options
     * @returns {Promise<Object>}
     */
    async createOrUpdateUser(username, password, options = {}) {
        return retryWithBackoff(async () => {
            // Check if user exists
            const existing = await this.getUser(username);

            const userData = {
                name: username,
                password: password,
                profile: options.profile || config.hotspot.defaultProfile,
                'shared-users': options.sharedUsers || 1,
                comment: options.comment || `Created: ${new Date().toISOString()}`
            };

            // Add optional parameters
            if (options.macAddress) userData['mac-address'] = options.macAddress;
            if (options.limitUptime) userData['limit-uptime'] = options.limitUptime;
            if (options.limitBytesIn) userData['limit-bytes-in'] = options.limitBytesIn;
            if (options.limitBytesOut) userData['limit-bytes-out'] = options.limitBytesOut;
            if (options.limitBytesTotal) userData['limit-bytes-total'] = options.limitBytesTotal;
            if (options.rateLimit) userData['rate-limit'] = options.rateLimit;

            if (existing) {
                // Update existing user
                logger.info(`Updating MikroTik user: ${username}`);
                const response = await this.client.patch(
                    `${this.baseURL}/ip/hotspot/user/${existing['.id']}`,
                    userData
                );
                return { ...response.data, action: 'updated' };
            } else {
                // Create new user
                logger.info(`Creating MikroTik user: ${username}`);
                const response = await this.client.put(
                    `${this.baseURL}/ip/hotspot/user`,
                    userData
                );
                return { ...response.data, action: 'created' };
            }
        });
    }

    /**
     * Get hotspot user by username
     * @param {string} username - Username
     * @returns {Promise<Object|null>}
     */
    async getUser(username) {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/user?name=${username}`
            );
            return response.data[0] || null;
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    /**
     * Delete hotspot user
     * @param {string} username - Username
     * @returns {Promise<boolean>}
     */
    async deleteUser(username) {
        return retryWithBackoff(async () => {
            const user = await this.getUser(username);
            if (!user) {
                logger.warn(`User not found for deletion: ${username}`);
                return false;
            }

            await this.client.delete(
                `${this.baseURL}/ip/hotspot/user/${user['.id']}`
            );
            logger.info(`Deleted MikroTik user: ${username}`);
            return true;
        });
    }

    /**
     * Get all hotspot users
     * @param {Object} filters - Optional filters
     * @returns {Promise<Array>}
     */
    async getAllUsers(filters = {}) {
        return retryWithBackoff(async () => {
            let url = `${this.baseURL}/ip/hotspot/user`;

            // Add query parameters if filters provided
            const params = new URLSearchParams();
            if (filters.profile) params.append('profile', filters.profile);
            if (filters.comment) params.append('comment', filters.comment);

            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            const response = await this.client.get(url);
            return response.data || [];
        });
    }

    /**
     * Get active hotspot sessions
     * @returns {Promise<Array>}
     */
    async getActiveSessions() {
        return retryWithBackoff(async () => {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/active`
            );
            return response.data || [];
        });
    }

    /**
     * Get active session for specific user
     * @param {string} username - Username
     * @returns {Promise<Object|null>}
     */
    async getUserSession(username) {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/active?user=${username}`
            );
            return response.data[0] || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Disconnect/kick user
     * @param {string} username - Username
     * @returns {Promise<boolean>}
     */
    async disconnectUser(username) {
        return retryWithBackoff(async () => {
            const session = await this.getUserSession(username);
            if (!session) {
                logger.warn(`No active session found for: ${username}`);
                return false;
            }

            await this.client.delete(
                `${this.baseURL}/ip/hotspot/active/${session['.id']}`
            );
            logger.info(`Disconnected user: ${username}`);
            return true;
        });
    }

    /**
     * Get user bandwidth usage
     * @param {string} username - Username
     * @returns {Promise<Object>}
     */
    async getUserStats(username) {
        return retryWithBackoff(async () => {
            const user = await this.getUser(username);
            if (!user) return null;

            return {
                username: user.name,
                uptime: user.uptime || '0s',
                bytesIn: parseInt(user['bytes-in'] || 0),
                bytesOut: parseInt(user['bytes-out'] || 0),
                packetsIn: parseInt(user['packets-in'] || 0),
                packetsOut: parseInt(user['packets-out'] || 0),
                dynamic: user.dynamic === 'true',
                disabled: user.disabled === 'true',
                lastCallerId: user['last-caller-id'],
                lastLoggedOut: user['last-logged-out']
            };
        });
    }

    /**
     * Get all active sessions with details
     * @returns {Promise<Array>}
     */
    async getDetailedSessions() {
        return retryWithBackoff(async () => {
            const [activeSessions, users] = await Promise.all([
                this.getActiveSessions(),
                this.getAllUsers()
            ]);

            const userMap = new Map(users.map(u => [u.name, u]));

            return activeSessions.map(session => {
                const user = userMap.get(session.user) || {};
                return {
                    id: session['.id'],
                    user: session.user,
                    address: session.address,
                    macAddress: session['mac-address'],
                    loginBy: session['login-by'],
                    uptime: session.uptime,
                    idleTime: session['idle-time'],
                    bytesIn: parseInt(session['bytes-in'] || 0),
                    bytesOut: parseInt(session['bytes-out'] || 0),
                    packetsIn: parseInt(session['packets-in'] || 0),
                    packetsOut: parseInt(session['packets-out'] || 0),
                    radius: session.radius === 'true',
                    blocked: session.blocked === 'true',
                    profile: user.profile || 'default',
                    comment: user.comment || ''
                };
            });
        });
    }

    /**
     * Create guest user with limitations
     * @param {string} mac - MAC address
     * @param {Object} limits - Limit options
     * @returns {Promise<Object>}
     */
    async createGuestUser(mac, limits = {}) {
        const username = `guest_${mac.replace(/:/g, '')}`;
        const password = Math.random().toString(36).substring(2, 10);

        const options = {
            profile: 'guest',
            macAddress: mac,
            limitUptime: limits.uptime || '1h',
            limitBytesTotal: limits.bytes || '500M',
            sharedUsers: 1,
            comment: `Guest-${new Date().toISOString()}-${mac}`
        };

        const result = await this.createOrUpdateUser(username, password, options);

        return {
            username,
            password,
            ...result
        };
    }

    /**
     * Bind user to MAC address (permanent binding)
     * @param {string} username - Username
     * @param {string} mac - MAC address
     * @returns {Promise<Object>}
     */
    async bindToMac(username, mac) {
        return retryWithBackoff(async () => {
            const user = await this.getUser(username);
            if (!user) throw new Error('User not found');

            const response = await this.client.patch(
                `${this.baseURL}/ip/hotspot/user/${user['.id']}`,
                {
                    'mac-address': mac
                }
            );

            logger.info(`Bound user ${username} to MAC ${mac}`);
            return response.data;
        });
    }

    /**
     * Unbind user from MAC address
     * @param {string} username - Username
     * @returns {Promise<Object>}
     */
    async unbindFromMac(username) {
        return retryWithBackoff(async () => {
            const user = await this.getUser(username);
            if (!user) throw new Error('User not found');

            const response = await this.client.patch(
                `${this.baseURL}/ip/hotspot/user/${user['.id']}`,
                {
                    'mac-address': ''
                }
            );

            logger.info(`Unbound user ${username} from MAC`);
            return response.data;
        });
    }

    /**
     * Set bandwidth limit for user
     * @param {string} username - Username
     * @param {string} rateLimit - Rate limit string (e.g., "10M/10M")
     * @returns {Promise<Object>}
     */
    async setRateLimit(username, rateLimit) {
        return retryWithBackoff(async () => {
            const user = await this.getUser(username);
            if (!user) throw new Error('User not found');

            const response = await this.client.patch(
                `${this.baseURL}/ip/hotspot/user/${user['.id']}`,
                {
                    'rate-limit': rateLimit
                }
            );

            logger.info(`Set rate limit ${rateLimit} for user ${username}`);
            return response.data;
        });
    }

    /**
     * Get hotspot configuration
     * @returns {Promise<Object>}
     */
    async getHotspotConfig() {
        return retryWithBackoff(async () => {
            const [servers, profiles, active] = await Promise.all([
                this.client.get(`${this.baseURL}/ip/hotspot`),
                this.client.get(`${this.baseURL}/ip/hotspot/profile`),
                this.getActiveSessions()
            ]);

            return {
                servers: servers.data || [],
                profiles: profiles.data || [],
                activeSessions: active.length,
                serverName: config.hotspot.dnsName
            };
        });
    }

    /**
     * Get walled garden entries
     * @returns {Promise<Array>}
     */
    async getWalledGarden() {
        return retryWithBackoff(async () => {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/walled-garden`
            );
            return response.data || [];
        });
    }

    /**
     * Add walled garden entry
     * @param {Object} entry - Walled garden entry
     * @returns {Promise<Object>}
     */
    async addWalledGardenEntry(entry) {
        return retryWithBackoff(async () => {
            const response = await this.client.put(
                `${this.baseURL}/ip/hotspot/walled-garden`,
                entry
            );
            return response.data;
        });
    }

    /**
     * Remove walled garden entry
     * @param {string} id - Entry ID
     * @returns {Promise<void>}
     */
    async removeWalledGardenEntry(id) {
        return retryWithBackoff(async () => {
            await this.client.delete(
                `${this.baseURL}/ip/hotspot/walled-garden/${id}`
            );
        });
    }

    /**
     * Get DHCP leases
     * @param {Object} filters - Filters
     * @returns {Promise<Array>}
     */
    async getDhcpLeases(filters = {}) {
        return retryWithBackoff(async () => {
            let url = `${this.baseURL}/ip/dhcp-server/lease`;

            if (filters.macAddress) {
                url += `?mac-address=${filters.macAddress}`;
            }

            const response = await this.client.get(url);
            return response.data || [];
        });
    }

    /**
     * Find user by MAC address
     * @param {string} mac - MAC address
     * @returns {Promise<Object|null>}
     */
    async findUserByMac(mac) {
        try {
            const response = await this.client.get(
                `${this.baseURL}/ip/hotspot/user?mac-address=${mac}`
            );
            return response.data[0] || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Batch create users
     * @param {Array} users - Array of user objects
     * @returns {Promise<Array>}
     */
    async batchCreateUsers(users) {
        const results = [];

        for (const user of users) {
            try {
                const result = await this.createOrUpdateUser(
                    user.username,
                    user.password,
                    user.options || {}
                );
                results.push({ success: true, username: user.username, result });
            } catch (error) {
                results.push({
                    success: false,
                    username: user.username,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Get bandwidth usage statistics
     * @param {string} username - Optional specific user
     * @returns {Promise<Object>}
     */
    async getBandwidthStats(username = null) {
        return retryWithBackoff(async () => {
            let url = `${this.baseURL}/ip/hotspot/user`;
            if (username) {
                url += `?name=${username}`;
            }

            const response = await this.client.get(url);
            const users = username ? [response.data[0]].filter(Boolean) : response.data;

            const stats = users.map(user => ({
                username: user.name,
                bytesIn: parseInt(user['bytes-in'] || 0),
                bytesOut: parseInt(user['bytes-out'] || 0),
                totalBytes: parseInt(user['bytes-in'] || 0) + parseInt(user['bytes-out'] || 0),
                uptime: user.uptime || '0s'
            }));

            if (username) {
                return stats[0] || null;
            }

            // Aggregate stats
            const totalIn = stats.reduce((sum, s) => sum + s.bytesIn, 0);
            const totalOut = stats.reduce((sum, s) => sum + s.bytesOut, 0);

            return {
                users: stats,
                summary: {
                    totalUsers: stats.length,
                    totalBytesIn: totalIn,
                    totalBytesOut: totalOut,
                    totalBytes: totalIn + totalOut
                }
            };
        });
    }
}

module.exports = new MikroTikAPI();