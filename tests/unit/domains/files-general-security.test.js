import FilesDomain from '../../../src/domains/files/index.js';
import GeneralDomain from '../../../src/domains/general/index.js';
import SecurityDomain from '../../../src/domains/security/index.js';

describe('FilesDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new FilesDomain();
  });

  test('registers listFiles, uploadFile, deleteFile tools (among others)', () => {
    const names = domain.getSkills().map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['deleteFile', 'listFiles', 'uploadFile']));
  });

  test('listFiles() returns a success flag and a files array', async () => {
    const result = await domain.execute({ tool: 'listFiles', params: '/docs' });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.files)).toBe(true);
  });

  test('uploadFile() correctly binds each array element to its own positional argument', async () => {
    const result = await domain.execute({
      tool: 'uploadFile',
      params: ['https://example.com/a.png', 'uploads/a.png'],
    });
    expect(result.success).toBe(true);
    expect(result.path).toBe('uploads/a.png');
    expect(result.url).toBe('https://cdn.br3eze.africa/uploads/a.png');
  });

  test('deleteFile() reports success and deleted:true', async () => {
    const result = await domain.execute({ tool: 'deleteFile', params: '/tmp/x.txt' });
    expect(result).toEqual({ success: true, deleted: true });
  });
});

describe('GeneralDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new GeneralDomain();
  });

  test('registers now, uuid, hash, safeMath tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual([
      'hash',
      'now',
      'safeMath',
      'uuid',
    ]);
  });

  test('now() returns a valid ISO timestamp', async () => {
    const result = await domain.execute({ tool: 'now', params: undefined });
    expect(new Date(result).toISOString()).toBe(result);
  });

  test('uuid() returns a well-formed v4 UUID', async () => {
    const result = await domain.execute({ tool: 'uuid', params: undefined });
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('uuid() returns different values on successive calls', async () => {
    const a = await domain.execute({ tool: 'uuid', params: undefined });
    const b = await domain.execute({ tool: 'uuid', params: undefined });
    expect(a).not.toBe(b);
  });

  test('hash() produces a stable, correct SHA-256 hex digest', async () => {
    const result = await domain.execute({ tool: 'hash', params: 'hello' });
    // Known SHA-256 of "hello"
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  describe('safeMath()', () => {
    test('adds two numbers', async () => {
      expect(await domain.execute({ tool: 'safeMath', params: ['add', 2, 3] })).toBe(5);
    });
    test('subtracts two numbers', async () => {
      expect(await domain.execute({ tool: 'safeMath', params: ['sub', 5, 2] })).toBe(3);
    });
    test('multiplies two numbers', async () => {
      expect(await domain.execute({ tool: 'safeMath', params: ['mul', 4, 3] })).toBe(12);
    });
    test('divides two numbers', async () => {
      expect(await domain.execute({ tool: 'safeMath', params: ['div', 10, 2] })).toBe(5);
    });
    test('division by zero returns the string "Infinity" instead of throwing', async () => {
      expect(await domain.execute({ tool: 'safeMath', params: ['div', 10, 0] })).toBe('Infinity');
    });
    test('an unknown operator throws a clear error', async () => {
      await expect(
        domain.execute({ tool: 'safeMath', params: ['pow', 2, 3] })
      ).rejects.toThrow('Unknown operator: pow');
    });
  });
});

describe('SecurityDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new SecurityDomain();
  });

  test('registers audit and sessions tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['audit', 'sessions']);
  });

  test('audit() reports healthy status with uptime, memory, and checks', async () => {
    const result = await domain.execute({ tool: 'audit', params: undefined });
    expect(result.status).toBe('healthy');
    expect(result.uptime).toMatch(/^\d+s$/);
    expect(result.memory).toMatch(/MB$/);
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  test('sessions() returns a list of active sessions with expected fields', async () => {
    const result = await domain.execute({ tool: 'sessions', params: undefined });
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty('user');
    expect(result[0]).toHaveProperty('ip');
    expect(result[0]).toHaveProperty('active');
  });
});
