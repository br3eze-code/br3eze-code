/**
 * Provider-neutral system capability port.
 *
 * Operating-system and infrastructure commands belong in adapters. This port
 * accepts a logical target and delegates to the adapter selected by the host;
 * it contains no shell commands, RouterOS APIs, or vendor dependencies.
 */

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function createSystemPort({
  resolveTargetAdapter,
  authorize,
  requestApproval,
} = {}) {
  requireFunction(resolveTargetAdapter, 'resolveTargetAdapter');
  requireFunction(authorize, 'authorize');
  requireFunction(requestApproval, 'requestApproval');

  return Object.freeze({
    async reboot({ target, reason, mode = 'graceful', context = {} } = {}) {
      if (typeof target !== 'string' || !target.trim()) {
        throw new TypeError('SYSTEM_REBOOT_TARGET_REQUIRED');
      }
      if (typeof reason !== 'string' || !reason.trim()) {
        throw new TypeError('SYSTEM_REBOOT_REASON_REQUIRED');
      }
      if (!['graceful', 'immediate'].includes(mode)) {
        throw new TypeError('SYSTEM_REBOOT_MODE_INVALID');
      }
      if (!context.tenantId || !context.userId) {
        throw new Error('SYSTEM_REBOOT_IDENTITY_REQUIRED');
      }

      const request = Object.freeze({
        capability: 'system.reboot',
        target: target.trim(),
        reason: reason.trim(),
        mode,
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });

      if (!await authorize(request, context)) {
        throw new Error('SYSTEM_REBOOT_FORBIDDEN');
      }
      if (!await requestApproval(request, context)) {
        throw new Error('SYSTEM_REBOOT_APPROVAL_REQUIRED');
      }

      const adapter = await resolveTargetAdapter(request.target, context);
      if (!adapter || typeof adapter.reboot !== 'function') {
        throw new Error('SYSTEM_REBOOT_ADAPTER_UNAVAILABLE');
      }

      const result = await adapter.reboot({
        target: request.target,
        reason: request.reason,
        mode: request.mode,
        context,
      });

      return Object.freeze({
        capability: 'system.reboot',
        target: request.target,
        status: 'requested',
        adapter: String(adapter.id || adapter.name || 'registered-system-adapter'),
        result: result ?? null,
      });
    },
  });
}

export default createSystemPort;
