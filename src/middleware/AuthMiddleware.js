import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * Canonical authentication/authorization middleware for the AgentOS core.
 *
 * User identity is established from a signed JWT. Gateway/service credentials
 * must be handled by the transport boundary and are deliberately not treated
 * as user identities here.
 */
class AuthMiddleware {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET || '';
    this.allowLegacyApiKey = options.allowLegacyApiKey === true;
  }

  async authenticate(token) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error('Authentication token required');
    }
    const decoded = this.verifyToken(token.trim());
    const userId = decoded.uid || decoded.sub;
    if (!userId) throw new Error('Authenticated identity is missing');

    const permissions = await this._resolvePermissions(userId, decoded);
    return {
      userId,
      provider: decoded.firebase ? 'firebase' : (decoded.provider || 'jwt'),
      email: decoded.email || null,
      roles: Array.isArray(decoded.roles) ? decoded.roles : [],
      permissions,
      sessionId: decoded.jti || null,
      authenticatedAt: Date.now()
    };
  }

  verifyToken(token) {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }
    const jwt = require('jsonwebtoken');
    return jwt.verify(token, this.jwtSecret, {
      algorithms: ['HS256']
    });
  }

  async _resolvePermissions(userId, decoded = {}) {
    const stored = this.agent?.memory?.getPermissions
      ? await this.agent.memory.getPermissions(userId)
      : [];
    const permissions = Array.isArray(stored) ? stored : [];
    const claimed = Array.isArray(decoded.permissions) ? decoded.permissions : [];
    return [...new Set([...permissions, ...claimed])];
  }

  async checkPermission(userId, requiredPermission) {
    if (!userId || typeof requiredPermission !== 'string' || !requiredPermission) {
      return false;
    }
    const permissions = await this._resolvePermissions(userId);
    return permissions.includes(requiredPermission) || permissions.includes('admin');
  }

  async authorize(identity, requiredPermission, resourceOwnerId = null) {
    if (!identity?.userId) return false;
    if (resourceOwnerId && identity.userId !== resourceOwnerId && !identity.permissions?.includes('admin')) {
      return false;
    }
    return this.checkPermission(identity.userId, requiredPermission);
  }
}

export { AuthMiddleware };
