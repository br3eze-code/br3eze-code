import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { test, before, after } from 'node:test';
import { createProjectManagerRouter } from '../../src/routes/project-manager.js';
import { MemoryProjectManagerStateStore } from '../../src/core/project-manager-state-store.js';
import { createProjectManagerContext } from '../../src/core/project-manager-context.js';
import { createApproval, confirmApproval, createRoleBoundHandoff } from '../../src/core/wbs-handoff-schema.js';

let server;
let baseUrl;
let currentNow = Date.now();
const store = new MemoryProjectManagerStateStore();

function call(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-user-id': options.userId || 'operator-1',
        'x-tenant-id': options.tenantId || 'tenant-a',
        'x-permissions': options.permissions || 'project.message,wbs.read,wbs.delegate.procurement,wbs.delegate.video',
        ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  const app = express();
  app.use('/api/v1/project-manager', createProjectManagerRouter({ store, now: () => currentNow }));
  server = await new Promise(resolve => {
    const value = http.createServer(app).listen(0, '127.0.0.1', () => resolve(value));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise(resolve => server.close(resolve)));

test('preserves project session continuity when moving from PWA to Telegram', async () => {
  const pwa = await call('/api/v1/project-manager/message', {
    method: 'POST',
    body: { channel: 'pwa', conversationId: 'conv-7', projectId: 'project-1', message: 'Review the procurement package' },
  });
  assert.equal(pwa.status, 200);
  assert.equal(pwa.body.context.channel, 'pwa');

  const telegram = await call('/api/v1/project-manager/message', {
    method: 'POST',
    body: { channel: 'telegram', conversationId: 'conv-7', projectId: 'project-1', message: 'Continue the review' },
  });
  assert.equal(telegram.status, 200);
  assert.equal(telegram.body.context.channel, 'telegram');
  assert.equal(telegram.body.context.sessionId, pwa.body.context.sessionId);
  assert.equal(telegram.body.session.channelHistory.length, 2);
  assert.equal(telegram.body.session.tenantId, 'tenant-a');
});

test('does not expose a tenant session across tenants', async () => {
  const response = await call('/api/v1/project-manager/state', { tenantId: 'tenant-b', userId: 'operator-2' });
  assert.equal(response.status, 200);
  assert.equal(response.body.session, null);
});

test('expires an approval and refuses confirmation after its deadline', () => {
  const context = createProjectManagerContext({ headers: { 'x-user-id': 'operator-1', 'x-tenant-id': 'tenant-a' } }, { projectId: 'project-1', channel: 'pwa' });
  const approval = createApproval({ context, handoffId: 'HO-1', action: 'draft_video_brief', argumentsValue: { scene: 'approved' }, ttlMs: 1 });
  assert.throws(() => confirmApproval(approval, context, new Date(approval.expiresAt).getTime() + 1), /expired/);
  assert.equal(approval.status, 'expired');
});

test('rejects a PWA-created approval when Telegram confirms after expiration', async () => {
  const pwa = await call('/api/v1/project-manager/handoffs', {
    method: 'POST',
    userId: 'operator-expiry',
    tenantId: 'tenant-expiry',
    body: {
      channel: 'pwa',
      conversationId: 'approval-conversation',
      projectId: 'project-expiry',
      packageId: 'WP-video-1',
      specialist: 'video',
      action: 'draft_video_brief',
      inputScope: ['redacted_media_refs'],
      summary: 'Prepare a redacted Seedance marketing brief',
    },
  });
  assert.equal(pwa.status, 201);
  assert.equal(pwa.body.approval.channel, 'pwa');
  assert.equal(pwa.body.approval.tenantId, 'tenant-expiry');

  const approval = store.getApproval(pwa.body.approval.approvalId, 'tenant-expiry');
  approval.expiresAt = new Date(currentNow + 1).toISOString();
  store.saveApproval(approval);
  currentNow += 2;

  const telegram = await call(`/api/v1/project-manager/approvals/${approval.approvalId}/confirm`, {
    method: 'POST',
    userId: 'operator-expiry',
    tenantId: 'tenant-expiry',
    body: { channel: 'telegram', conversationId: 'approval-conversation', projectId: 'project-expiry' },
  });
  assert.equal(telegram.status, 410);
  assert.equal(telegram.body.code, 'APPROVAL_EXPIRED');
  assert.match(telegram.body.error, /expired/i);
  assert.equal(store.getApproval(approval.approvalId, 'tenant-expiry').status, 'expired');
});

test('does not allow another Telegram identity to confirm a PWA approval', async () => {
  const pwa = await call('/api/v1/project-manager/handoffs', {
    method: 'POST',
    userId: 'operator-owner',
    tenantId: 'tenant-owner',
    body: {
      channel: 'pwa', conversationId: 'approval-owner', projectId: 'project-owner', packageId: 'WP-1',
      specialist: 'video', action: 'draft_video_brief', inputScope: ['redacted_media_refs'],
    },
  });
  assert.equal(pwa.status, 201);
  const telegram = await call(`/api/v1/project-manager/approvals/${pwa.body.approval.approvalId}/confirm`, {
    method: 'POST', userId: 'different-telegram-user', tenantId: 'tenant-owner',
    body: { channel: 'telegram', conversationId: 'approval-owner', projectId: 'project-owner' },
  });
  assert.equal(telegram.status, 403);
  assert.equal(telegram.body.code, 'APPROVAL_SCOPE_MISMATCH');
});

test('requires the correct role-bound delegation permission', () => {
  const procurementContext = createProjectManagerContext({ headers: { 'x-user-id': 'operator-1', 'x-tenant-id': 'tenant-a' } }, {
    projectId: 'project-1', channel: 'pwa',
  });
  procurementContext.permissions = ['wbs.delegate.procurement'];
  const procurement = createRoleBoundHandoff({ context: procurementContext, projectId: 'project-1', packageId: 'WP-1', specialist: 'procurement', action: 'compare_quotes', inputScope: ['approved_requirements'] });
  assert.equal(procurement.to, 'procurement-specialist');
  assert.equal(procurement.approvalRequired, true);
  assert.ok(procurement.prohibitedScope.includes('payment_authorization'));

  const videoContext = { ...procurementContext, permissions: ['wbs.delegate.video'] };
  const video = createRoleBoundHandoff({ context: videoContext, projectId: 'project-1', packageId: 'WP-2', specialist: 'video', action: 'draft_video_brief', inputScope: ['redacted_media_refs'] });
  assert.equal(video.to, 'video-specialist');
  assert.ok(video.prohibitedScope.includes('raw_cctv_streams'));
});
