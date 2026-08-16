import express from 'express';
import request from 'supertest';
import { buildExecutionContext } from '../../src/core/execution-context.js';
import { createBatchRouter } from '../../src/interfaces/batch-api.js';

describe('device capture and batch user context', () => {
  test('captures safe device metadata without treating it as identity or authorization', () => {
    const context = buildExecutionContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      deviceInfo: {
        platform: 'android',
        model: 'Pixel 9',
        osVersion: '15',
        appVersion: '1.2.3',
        deviceId: 'install-1',
        userId: 'spoofed-user',
        tenantId: 'spoofed-tenant',
      },
      authorizedCapabilities: ['network.read'],
    });

    expect(context.deviceInfo).toMatchObject({ platform: 'android', model: 'Pixel 9', osVersion: '15', appVersion: '1.2.3', deviceId: 'install-1' });
    expect(context.userId).toBe('user-1');
    expect(context.tenantId).toBe('tenant-1');
    expect(context.authorizedCapabilities).toEqual(['network.read']);
    expect(context.deviceInfo.userId).toBeUndefined();
    expect(context.deviceInfo.tenantId).toBeUndefined();
  });

  test('batch API ignores body context overrides for authenticated scope and location permission', async () => {
    const seen = [];
    const app = express();
    app.use(express.json());
    app.use(createBatchRouter({
      authorize: async () => ({
        userId: 'user-1',
        tenantId: 'tenant-trusted',
        domain: 'network',
        authorizedSiteIds: ['site-trusted'],
        capabilities: ['network.suggest'],
        locationPermission: false,
      }),
      agent: {
        handle: async ({ context }) => {
          seen.push(context);
          return { ok: true };
        },
      },
    }));

    const response = await request(app)
      .post('/batch/execute')
      .set('Idempotency-Key', 'batch-1')
      .send({
        context: {
          tenantId: 'tenant-spoofed',
          authorizedSiteIds: ['site-spoofed'],
          capabilities: ['admin.all'],
          locationPermission: 'granted',
          nearby: true,
        },
        items: [{ tool: 'network.suggest' }],
      });

    expect(response.status).toBe(207);
    expect(seen[0]).toMatchObject({ tenantId: 'tenant-trusted', authorizedSiteIds: ['site-trusted'], capabilities: ['network.suggest'], locationPermission: false, nearby: false });
  });
});

export {};
