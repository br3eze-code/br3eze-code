/**
 * Provider-neutral reporting port.
 *
 * Reports are projections over trusted, host-supplied records. This module
 * never invents missing metrics or reaches into a provider directly.
 */
export function createReportPort({ authorize, queryRecords, clock = () => new Date() } = {}) {
  if (typeof authorize !== 'function') throw new TypeError('REPORT_AUTHORIZE_REQUIRED');
  if (typeof queryRecords !== 'function') throw new TypeError('REPORT_QUERY_REQUIRED');

  return Object.freeze({
    async generate({ type = 'execution', filters = {}, context = {} } = {}) {
      if (!context.tenantId || !context.userId) throw new Error('REPORT_IDENTITY_REQUIRED');
      if (typeof type !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/i.test(type)) {
        throw new TypeError('REPORT_TYPE_INVALID');
      }
      if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
        throw new TypeError('REPORT_FILTERS_INVALID');
      }
      const request = Object.freeze({
        capability: 'report',
        type,
        filters: Object.freeze({ ...filters }),
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId || null,
      });
      if (!await authorize(request, context)) throw new Error('REPORT_FORBIDDEN');
      const result = await queryRecords(request, context);
      if (!result || !Array.isArray(result.records)) throw new Error('REPORT_SOURCE_INVALID');
      const records = result.records;
      return Object.freeze({
        capability: 'report',
        schemaVersion: '1.0',
        type,
        tenantId: context.tenantId,
        generatedAt: clock().toISOString(),
        source: result.source || 'registered-report-source',
        count: records.length,
        records,
        ...(result.summary === undefined ? {} : { summary: result.summary }),
        ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
      });
    },
  });
}

export default createReportPort;
