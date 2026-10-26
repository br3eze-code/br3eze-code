import { describe, expect, test, jest } from '@jest/globals';
import { createReportPort } from '../../src/core/ports/report.js';

const context = { tenantId: 'tenant-a', userId: 'user-a', requestId: 'req-1' };

describe('report port', () => {
  test('generates a versioned report from trusted source records', async () => {
    const queryRecords = jest.fn(async () => ({
      source: 'execution-store',
      records: [{ executionId: 'exec-1', status: 'completed' }],
      summary: { completed: 1 },
    }));
    const port = createReportPort({
      authorize: async () => true,
      queryRecords,
      clock: () => new Date('2026-10-26T10:00:00.000Z'),
    });
    const report = await port.generate({ type: 'execution', filters: { status: 'completed' }, context });
    expect(report).toMatchObject({
      capability: 'report',
      schemaVersion: '1.0',
      type: 'execution',
      tenantId: 'tenant-a',
      generatedAt: '2026-10-26T10:00:00.000Z',
      source: 'execution-store',
      count: 1,
      summary: { completed: 1 },
    });
    expect(queryRecords).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', userId: 'user-a', type: 'execution',
    }), context);
  });

  test('fails closed for missing identity, denied access, and invalid source data', async () => {
    const port = createReportPort({ authorize: async () => false, queryRecords: async () => ({ records: [] }) });
    await expect(port.generate({ context: {} })).rejects.toThrow('REPORT_IDENTITY_REQUIRED');
    await expect(port.generate({ context })).rejects.toThrow('REPORT_FORBIDDEN');
    const invalid = createReportPort({ authorize: async () => true, queryRecords: async () => ({ records: null }) });
    await expect(invalid.generate({ context })).rejects.toThrow('REPORT_SOURCE_INVALID');
  });
});
