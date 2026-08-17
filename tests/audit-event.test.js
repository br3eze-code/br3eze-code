import { AuditLogger } from '../src/core/audit.js';

describe('structured audit events', () => {
  test('records a tenant-scoped full execution trace', async () => {
    const logger = new AuditLogger(null, null, () => Date.parse('2026-08-17T10:00:00.000Z'));
    const event = await logger.recordEvent('TOOL_EXECUTED', {
      tenantId: 'tenant-a', siteId: 'site-a', principalId: 'principal-1', channelIdentityId: 'telegram-1',
      workId: 'work-1', loopId: 'loop-1', executionId: 'exec-1', resourceId: 'router-1',
      traceId: 'trace-1', requestId: 'request-1', decision: 'allowed', evidenceRefs: ['snapshot-1']
    });
    expect(event).toMatchObject({ eventType: 'TOOL_EXECUTED', tenantId: 'tenant-a', siteId: 'site-a', correlationId: 'trace-1', evidenceRefs: ['snapshot-1'] });
    expect(logger.recent(1)).toHaveLength(1);
  });

  test('rejects site or resource events without tenant scope', async () => {
    const logger = new AuditLogger();
    await expect(logger.recordEvent('SITE_CREATED', { siteId: 'site-a' })).rejects.toThrow('Tenant scope is required');
  });
});
