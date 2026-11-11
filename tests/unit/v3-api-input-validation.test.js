import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, test } from '@jest/globals';
import v3Router from '../../src/api/routes/v3.js';

const app = express();
app.use(express.json());
app.use('/api/v3', v3Router);

const originalDatabase = global.database;
const originalMikrotik = global.mikrotik;

afterEach(() => {
  if (originalDatabase === undefined) delete global.database;
  else global.database = originalDatabase;
  if (originalMikrotik === undefined) delete global.mikrotik;
  else global.mikrotik = originalMikrotik;
});

describe('v3 API endpoint input validation', () => {
  test('rejects voucher counts that are not integers within 1..100', async () => {
    global.database = {};
    const response = await request(app).post('/api/v3/bulk/vouchers').send({ count: '2x' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/count must be an integer/i);
  });

  test('rejects invalid voucher deletion status', async () => {
    global.database = {};
    const response = await request(app).delete('/api/v3/bulk/vouchers').send({ status: 'pending' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/status must be one of/i);
  });

  test('rejects oversized or malformed disconnect ID lists before device calls', async () => {
    global.mikrotik = {
      state: { isConnected: true },
      executeCommand: () => { throw new Error('must not execute'); }
    };
    const response = await request(app).post('/api/v3/bulk/users/disconnect').send({ ids: ['valid', 42] });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/RouterOS ID strings/i);
  });

  test('rejects invalid router ping host and count before device calls', async () => {
    global.mikrotik = {
      state: { isConnected: true },
      executeTool: () => { throw new Error('must not execute'); }
    };
    const response = await request(app).post('/api/v3/diagnostics/ping-router').send({ host: 'router\n/system/reboot', count: 3 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/hostname or IP address/i);
  });

  test('rejects RouterOS command-like ping targets without contacting the router', async () => {
    global.mikrotik = {
      state: { isConnected: true },
      executeTool: () => { throw new Error('must not execute'); }
    };
    const response = await request(app).post('/api/v3/diagnostics/ping-router')
      .send({ host: 'router.local/system/reboot', count: 3 });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid hostname or IP address/i);
  });

  test('bounds audit pagination and rejects malformed numeric values', async () => {
    global.database = {};
    const response = await request(app).get('/api/v3/audit?limit=1000&offset=0');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/limit must be 1-100/i);
  });
});
