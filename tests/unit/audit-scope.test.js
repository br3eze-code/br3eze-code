import { jest } from '@jest/globals';
import SystemDriver from '../../src/skills/system/index.js';

describe('audit scope isolation', () => {
  test('system.audit always binds the caller tenant and user scope', async () => {
    const db = { getAuditLog: jest.fn().mockResolvedValue([]) };
    const driver = new SystemDriver({}, {});

    await driver.execute('system.audit', { hours: 24, domain: 'network', siteId: 'site-1' }, {
      db,
      userId: 'user-1',
      tenantId: 'tenant-a',
      allowedDomains: ['network'],
      authorizedSiteIds: ['site-1']
    });

    expect(db.getAuditLog).toHaveBeenCalledWith({
      limit: 50,
      hours: 24,
      userId: 'user-1',
      tenantId: 'tenant-a',
      domain: 'network',
      siteId: 'site-1'
    });
  });

  test('system.audit rejects a domain outside the caller scope', async () => {
    const driver = new SystemDriver({}, {});
    const db = { getAuditLog: jest.fn() };

    await expect(driver.execute('system.audit', { domain: 'cctv' }, {
      db,
      userId: 'user-1',
      tenantId: 'tenant-a',
      allowedDomains: ['network']
    })).rejects.toThrow('Audit domain is outside the caller scope');
    expect(db.getAuditLog).not.toHaveBeenCalled();
  });

  test('system.audit rejects a site outside the caller scope', async () => {
    const driver = new SystemDriver({}, {});
    const db = { getAuditLog: jest.fn() };

    await expect(driver.execute('system.audit', { siteId: 'site-2' }, {
      db,
      userId: 'user-1',
      tenantId: 'tenant-a',
      authorizedSiteIds: ['site-1']
    })).rejects.toThrow('Audit site is outside the caller scope');
    expect(db.getAuditLog).not.toHaveBeenCalled();
  });
});
