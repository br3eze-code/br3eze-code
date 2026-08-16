import express from 'express';
import { normalizeIotContext, redactIotContext } from '../core/iot-context.js';

const MAX_BATCH_ITEMS = 25;

function createBatchRouter({ agent, authorize } = {}) {
  if (!agent || typeof agent.handle !== 'function') throw new Error('Batch API requires an agent with handle()');
  const router = express.Router();

  router.post('/batch/execute', async (req, res) => {
    try {
      const authContext = typeof authorize === 'function' ? await authorize(req) : (req.authContext || req.user);
      if (!authContext) return res.status(401).json({ error: 'Unauthorized' });

      const body = req.body || {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > MAX_BATCH_ITEMS) {
        return res.status(400).json({ error: `items must contain 1-${MAX_BATCH_ITEMS} operations` });
      }

      const context = normalizeIotContext({
        ...authContext,
        ...body.context,
        userId: authContext.userId || authContext.uid,
        tenantId: authContext.tenantId,
        allowedDomains: authContext.allowedDomains,
        authorizedSiteIds: authContext.authorizedSiteIds,
        authorizedDeviceIds: authContext.authorizedDeviceIds,
        capabilities: authContext.capabilities,
        requestId: req.get('x-request-id') || undefined,
        readOnly: body.readOnly !== false
      });
      const seen = new Set();
      const results = [];

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        const key = String(item.idempotencyKey || `${context.requestId || 'batch'}:${index}`);
        if (seen.has(key)) {
          results.push({ index, idempotencyKey: key, status: 'duplicate' });
          continue;
        }
        seen.add(key);
        if (!item.tool || typeof item.tool !== 'string') {
          results.push({ index, idempotencyKey: key, status: 'rejected', error: 'tool is required' });
          continue;
        }
        try {
          const result = await agent.handle({
            tool: item.tool,
            args: item.args || {},
            context: { ...context, idempotencyKey: key }
          });
          results.push({ index, idempotencyKey: key, status: 'succeeded', result });
        } catch (error) {
          results.push({ index, idempotencyKey: key, status: 'failed', error: error.message });
        }
      }

      return res.status(207).json({
        success: results.every((item) => item.status === 'succeeded' || item.status === 'duplicate'),
        context: redactIotContext(context),
        results
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  return router;
}

const fastApiContract = Object.freeze({
  operationId: 'batch_execute',
  method: 'POST',
  path: '/batch/execute',
  maxItems: MAX_BATCH_ITEMS,
  request: {
    items: [{ idempotencyKey: 'string', tool: 'string', args: 'object' }],
    context: { contextLevel: 'tenant|domain|site|device|session', readOnly: 'boolean' }
  },
  response: {
    success: 'boolean',
    context: 'scoped context projection',
    results: [{ index: 'integer', status: 'succeeded|failed|rejected|duplicate', result: 'any', error: 'string?' }]
  }
});

export { MAX_BATCH_ITEMS, createBatchRouter, fastApiContract };
export default createBatchRouter;

