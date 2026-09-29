import {
  MemoryAuthHandoffStore,
  createPkceVerifier,
  createS256CodeChallenge,
} from '../../src/core/auth/authHandoff.js';

describe('Auth Handoff', () => {
  test('creates a short-lived device handoff with a server-issued nonce', async () => {
    const store = new MemoryAuthHandoffStore({ clock: () => 1_000 });
    const verifier = createPkceVerifier();
    const handoff = await store.create({
      clientId: 'device',
      action: 'signIn',
      codeChallenge: createS256CodeChallenge(verifier),
    });

    expect(handoff.nonce).toBeTruthy();
    expect(handoff.nonce).not.toContain('session');
    expect(handoff.status).toBe('pending');
    expect(handoff.expiresAt).toBe(301_000);
  });

  test('requires the original PKCE verifier during exchange', async () => {
    const store = new MemoryAuthHandoffStore({ clock: () => 1_000 });
    const verifier = createPkceVerifier();
    const handoff = await store.create({
      clientId: 'device',
      action: 'signIn',
      codeChallenge: createS256CodeChallenge(verifier),
    });

    const completed = await store.complete({
      nonce: handoff.nonce,
      user: { id: 'user-1', email: 'user@example.test' },
    });

    await expect(store.exchange({
      nonce: handoff.nonce,
      code: completed.exchangeCode,
      codeVerifier: createPkceVerifier(),
    })).rejects.toThrow('PKCE verification failed');
  });

  test('exchange is one-time and prevents replay', async () => {
    const store = new MemoryAuthHandoffStore({ clock: () => 1_000 });
    const verifier = createPkceVerifier();
    const handoff = await store.create({
      clientId: 'device',
      codeChallenge: createS256CodeChallenge(verifier),
    });
    const completed = await store.complete({
      nonce: handoff.nonce,
      user: { id: 'user-1' },
    });

    const result = await store.exchange({
      nonce: handoff.nonce,
      code: completed.exchangeCode,
      codeVerifier: verifier,
    });

    expect(result.user.id).toBe('user-1');

    await expect(store.exchange({
      nonce: handoff.nonce,
      code: completed.exchangeCode,
      codeVerifier: verifier,
    })).rejects.toThrow('Invalid or expired auth handoff');
  });

  test('rejects expiry and duplicate completion', async () => {
    let time = 1_000;
    const store = new MemoryAuthHandoffStore({ clock: () => time });
    const verifier = createPkceVerifier();
    const handoff = await store.create({
      clientId: 'device',
      codeChallenge: createS256CodeChallenge(verifier),
      ttlMs: 30_000,
    });

    time += 30_001;
    await expect(store.complete({
      nonce: handoff.nonce,
      user: { id: 'user-1' },
    })).rejects.toThrow('expired');

    time = 1_000;
    const next = await store.create({
      clientId: 'device',
      codeChallenge: createS256CodeChallenge(verifier),
    });
    await store.complete({ nonce: next.nonce, user: { id: 'user-1' } });
    await expect(store.complete({
      nonce: next.nonce,
      user: { id: 'user-2' },
    })).rejects.toThrow('already completed');
  });
});
