import express from 'express';
import request from 'supertest';
import { describe, expect, test, jest } from '@jest/globals';
import { createFirebaseDataSessionRouter } from '../../src/api/routes/firebase-data-session.js';

describe('Supabase to Firebase data-session bridge', () => {
  test('requires verified Supabase identity and issues a downstream data token', async () => {
    const auth = {
      getUserByEmail: jest.fn().mockRejectedValue({ code: 'auth/user-not-found' }),
      createUser: jest.fn().mockResolvedValue({ uid: 'firebase-user-1', disabled: false }),
      createCustomToken: jest.fn().mockResolvedValue('firebase-custom-token')
    };
    const requireUser = (req, _res, next) => {
      req.user = { id: 'supabase-user-1', email: 'user@example.com', emailVerified: true, role: 'user', tenantId: 'tenant-1' };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/', createFirebaseDataSessionRouter({ requireUser, getFirebaseAuth: () => auth }));

    const response = await request(app).post('/').send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ uid: 'firebase-user-1', provider: 'supabase', token: 'firebase-custom-token' });
    expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'supabase-user-1',
      email: 'user@example.com',
      emailVerified: true
    }));
    expect(auth.createCustomToken).toHaveBeenCalledWith('firebase-user-1', expect.objectContaining({
      supabase_uid: 'supabase-user-1',
      auth_provider: 'supabase',
      tenant_id: 'tenant-1'
    }));
  });

  test('does not mint Firebase tokens for unverified email identities', async () => {
    const getFirebaseAuth = jest.fn();
    const requireUser = (req, _res, next) => {
      req.user = { id: 'supabase-user-1', email: 'user@example.com', emailVerified: false };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use('/', createFirebaseDataSessionRouter({ requireUser, getFirebaseAuth }));

    const response = await request(app).post('/').send({});
    expect(response.status).toBe(403);
    expect(getFirebaseAuth).not.toHaveBeenCalled();
  });
});
