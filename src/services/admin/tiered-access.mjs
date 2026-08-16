import { EventEmitter } from 'node:events';

export const ROLES = Object.freeze({
  VIEWER: 'viewer',
  READONLY: 'readonly',
  OPERATOR: 'operator',
  FIELD_AGENT: 'field_agent',
  PARTNER: 'partner',
  REGIONAL_ADMIN: 'regional_admin',
  PLATFORM_ADMIN: 'platform_admin',
  SUPER_ADMIN: 'super_admin',
});

export const PERMISSIONS = Object.freeze({
  STARLINK_READ: 'starlink.read',
  FLEET_READ: 'starlink.fleet.read',
  TERMINAL_READ: 'starlink.terminal.read',
  STARLINK_OPERATE: 'starlink.operate',
  TERMINAL_REBOOT: 'starlink.terminal.reboot',
  TERMINAL_STOW: 'starlink.terminal.stow',
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_REFUND: 'payment.refund',
  ADMIN_ASSIGN: 'admin.assign',
  TERMINAL_PROVISION: 'starlink.terminal.provision',
  TERMINAL_DEACTIVATE: 'starlink.terminal.deactivate',
  SERVICE_LINE_CREATE: 'service_line.create',
  SERVICE_LINE_MODIFY: 'service_line.modify',
  BILLING_READ: 'billing.read',
  BILLING_MODIFY: 'billing.modify',
  FLEET_MANAGE: 'starlink.fleet.manage',
  USER_MANAGE: 'user.manage',
  REPORT_READ: 'report.read',
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.VIEWER]: [PERMISSIONS.STARLINK_READ, PERMISSIONS.FLEET_READ, PERMISSIONS.TERMINAL_READ, PERMISSIONS.REPORT_READ],
  [ROLES.READONLY]: [PERMISSIONS.STARLINK_READ, PERMISSIONS.FLEET_READ, PERMISSIONS.TERMINAL_READ, PERMISSIONS.REPORT_READ],
  [ROLES.OPERATOR]: [PERMISSIONS.STARLINK_READ, PERMISSIONS.FLEET_READ, PERMISSIONS.TERMINAL_READ, PERMISSIONS.STARLINK_OPERATE, PERMISSIONS.TERMINAL_REBOOT, PERMISSIONS.PAYMENT_CREATE],
  [ROLES.REGIONAL_ADMIN]: [PERMISSIONS.STARLINK_READ, PERMISSIONS.FLEET_READ, PERMISSIONS.TERMINAL_READ, PERMISSIONS.STARLINK_OPERATE, PERMISSIONS.TERMINAL_REBOOT, PERMISSIONS.TERMINAL_STOW, PERMISSIONS.PAYMENT_CREATE],
  [ROLES.PLATFORM_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.FIELD_AGENT]: [PERMISSIONS.TERMINAL_READ, PERMISSIONS.TERMINAL_REBOOT, PERMISSIONS.REPORT_READ],
  [ROLES.PARTNER]: [PERMISSIONS.TERMINAL_READ, PERMISSIONS.BILLING_READ, PERMISSIONS.REPORT_READ],
});

export class TieredAccessControl extends EventEmitter {
  constructor({ auditSink = () => {}, db = null } = {}) {
    super();
    this.auditSink = auditSink;
    this.db = db;
    this.assignments = new Map();
  }

  permissionsFor(role) {
    return [...(ROLE_PERMISSIONS[role] || [])];
  }

  assign(userId, { role = ROLES.VIEWER, regions = [], terminals = [] } = {}) {
    if (!userId || !ROLE_PERMISSIONS[role]) throw new Error('A valid userId and role are required');
    const assignment = { userId, role, regions: [...new Set(regions)], terminals: [...new Set(terminals)], updatedAt: new Date().toISOString() };
    this.assignments.set(String(userId), assignment);
    return { ...assignment, permissions: this.permissionsFor(role) };
  }

  get(userId) {
    const assignment = this.assignments.get(String(userId));
    return assignment ? { ...assignment, permissions: this.permissionsFor(assignment.role) } : null;
  }

  async assignUser(userId, role, scope = {}) {
    const assignment = this.assign(userId, { role, ...scope });
    if (this.db?.collection) {
      await this.db.collection('admin_assignments').doc(String(userId)).set({ ...assignment });
    }
    return assignment;
  }

  async loadAssignment(userId) {
    const cached = this.get(userId);
    if (cached || !this.db?.collection) return cached;
    const doc = await this.db.collection('admin_assignments').doc(String(userId)).get();
    if (!doc?.exists) return null;
    const data = doc.data();
    return this.assign(userId, data);
  }

  can(userId, permission, { terminalId, region, partnerId } = {}) {
    const assignment = this.assignments.get(String(userId));
    const unrestricted = assignment?.role === ROLES.PLATFORM_ADMIN || assignment?.role === ROLES.SUPER_ADMIN;
    const allowed = Boolean(assignment && this.permissionsFor(assignment.role).includes(permission)
      && (unrestricted || !terminalId || assignment.terminals.length === 0 || assignment.terminals.includes(String(terminalId)))
      && (unrestricted || !region || assignment.regions.length === 0 || assignment.regions.includes(region))
      && (unrestricted || !partnerId || !assignment.partnerId || assignment.partnerId === partnerId));
    const event = { userId: String(userId), permission, terminalId, region, allowed, at: new Date().toISOString() };
    this.emit('authorization:decision', event);
    this.auditSink(event);
    return allowed;
  }

  async canAsync(userId, permission, scope = {}) {
    return this.can(userId, permission, scope);
  }

  async getAccessibleTerminals(userId, terminals = []) {
    const assignment = this.assignments.get(String(userId));
    if (!assignment) return [];
    if (assignment.role === ROLES.PLATFORM_ADMIN) return [...terminals];
    return terminals.filter((terminal) => assignment.terminals.includes(String(terminal.id)));
  }

  auditLog(userId, action, details = {}, result = 'success') {
    const event = { userId: String(userId), action, details, result, at: new Date().toISOString() };
    this.emit('audit', event);
    this.auditSink(event);
    return event;
  }

  assert(userId, permission, scope = {}) {
    if (!this.can(userId, permission, scope)) {
      const error = new Error('Access denied');
      error.code = 'ACCESS_DENIED';
      throw error;
    }
    return true;
  }
}

export default TieredAccessControl;
