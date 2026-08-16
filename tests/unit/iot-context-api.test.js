import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  CAPABILITIES,
  normalizeIotContext,
  assertNearbyDiscovery,
  assertDeviceVisible
} from '../../src/core/iot-context.js';
import { createBatchRouter } from '../../src/interfaces/batch-api.js';
import CodegenSkill from '../../src/skills/codegen/index.js';

describe('IoT context and API boundaries', () => {
  test('nearby discovery requires site context, explicit nearby flag, and capability', () => {
    const context = normalizeIotContext({
      userId: 'u1',
      tenantId: 't1',
      domain: 'network',
      siteId: 'site-a',
      nearby: true,
      capabilities: [CAPABILITIES.DEVICE_DISCOVER]
    });
    expect(() => assertNearbyDiscovery(context)).not.toThrow();
    expect(() => assertDeviceVisible(context, { domain: 'network', siteId: 'site-a' })).not.toThrow();
    expect(() => assertDeviceVisible(context, { siteId: 'site-b' })).toThrow(/outside the authorized scope/);
  });

  test('domain context cannot discover nearby devices without site scope', () => {
    const context = normalizeIotContext({
      userId: 'u1',
      tenantId: 't1',
      domain: 'network',
      nearby: true,
      capabilities: [CAPABILITIES.DEVICE_DISCOVER]
    });
    expect(() => assertNearbyDiscovery(context)).toThrow(/site-level context/);
  });

  test('codegen uses generic FastAPI target and returns approval-required output', async () => {
    const skill = new CodegenSkill({}, { info: jest.fn(), debug: jest.fn() });
    const generate = jest.fn().mockResolvedValue({ text: 'from fastapi import FastAPI\napp = FastAPI()' });
    const result = await skill.execute('codegen.generate', {
      prompt: 'Create a health endpoint',
      target: 'fastapi'
    }, {
      userId: 'u1',
      tenantId: 't1',
      contextLevel: 'tenant',
      capabilities: [CAPABILITIES.CODE_GENERATE],
      llm: { generate }
    });
    expect(result.target).toBe('fastapi');
    expect(result.approvalRequired).toBe(true);
    expect(result.code).toContain('FastAPI');
    expect(generate).toHaveBeenCalled();
  });

  test('batch API uses authenticated tenant context and returns per-item results', async () => {
    const agent = { handle: jest.fn(async ({ tool, context }) => ({ tool, tenantId: context.tenantId })) };
    const app = express();
    app.use(express.json());
    app.use(createBatchRouter({
      agent,
      authorize: async () => ({
        userId: 'u1',
        tenantId: 't1',
        capabilities: ['network.suggest'],
        allowedDomains: ['network'],
        authorizedSiteIds: ['site-a']
      })
    }));
    const response = await request(app).post('/batch/execute').send({
      items: [
        { idempotencyKey: 'a', tool: 'network.suggest', args: { siteId: 'site-a' } },
        { idempotencyKey: 'a', tool: 'network.suggest', args: { siteId: 'site-a' } }
      ]
    });
    expect(response.status).toBe(207);
    expect(response.body.context.tenantId).toBe('t1');
    expect(response.body.results.map((item) => item.status)).toEqual(['succeeded', 'duplicate']);
  });
});
