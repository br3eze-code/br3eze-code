let provider = null;

export function registerBillingProvider(implementation) {
  if (typeof implementation !== 'function' && typeof implementation?.create !== 'function') {
    throw new TypeError('Billing provider must be a constructor or factory');
  }
  provider = implementation;
  return provider;
}

export function getBillingProvider() {
  if (!provider) throw new Error('No billing provider registered');
  return provider;
}

export function createBilling(config = {}) {
  const Provider = getBillingProvider();
  return typeof Provider.create === 'function' ? Provider.create(config) : new Provider(config);
}

const SYSTEM_USERS = new Set(['admin', 'default', 'root']);

export default class UniversalBilling {
  constructor(config = {}) {
    this.db = config.database || null;
    this.mikrotik = config.mikrotik || null;
    this.resourceType = config.resourceType || 'generic';
  }

  async checkVoucherStatus(voucher) {
    if (!voucher) return { expired: true, reason: 'not_found' };
    if (voucher.status === 'expired') return { expired: true, reason: 'expired' };
    if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() <= Date.now()) {
      return { expired: true, reason: 'time_expired' };
    }
    return { expired: false, reason: null };
  }

  async guardHotspot() {
    if (!this.mikrotik?.state?.isConnected) return;
    const users = await this.mikrotik.executeTool('users.report') || [];
    for (const user of users) {
      const username = user?.username;
      if (!username || SYSTEM_USERS.has(username)) continue;
      try {
        const voucher = await this.db?.getVoucher?.(username);
        const status = await this.checkVoucherStatus(voucher);
        if (status.expired) {
          if (user.isActive) await this.mikrotik.executeTool('user.kick', { username });
          await this.db?.expireVoucher?.(username);
        } else if (user.disabled) {
          await this.mikrotik.executeTool('user.enable', { username });
        }
      } catch (error) {
        const { logger } = await import('./logger.js');
        logger.error(`Failed to process user ${username}`, { error: error.message });
      }
    }

    const active = await this.db?.getVouchersByStatus?.('active') || [];
    for (const voucher of active) {
      const status = await this.checkVoucherStatus(voucher);
      if (status.expired) await this.db?.expireVoucher?.(voucher.code);
    }
  }
}
