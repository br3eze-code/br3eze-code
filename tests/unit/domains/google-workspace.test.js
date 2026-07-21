import { jest } from '@jest/globals';
import GoogleWorkspaceDomain from '../../../src/domains/google-workspace/index.js';

describe('GoogleWorkspaceDomain', () => {
  let domain;

  beforeEach(() => {
    domain = new GoogleWorkspaceDomain({ config: {}, logger: console });
  });

  test('registers a tool for every entry returned by GoogleWorkspaceSkill.getTools()', () => {
    const names = domain.getSkills().map(t => t.name);
    expect(names).toContain('google_docs_list');
    expect(names).toContain('google_docs_create');
    // dots must be converted to underscores in the registered tool name
    expect(names.every(n => !n.includes('.'))).toBe(true);
  });

  test('each registered tool carries over its description and parameters', () => {
    const listTool = domain.getSkills().find(t => t.name === 'google_docs_list');
    expect(listTool.description).toBe('List Google Drive documents');
    expect(listTool.parameters).toHaveProperty('q');
    expect(listTool.parameters).toHaveProperty('pageSize');
  });

  test('execute() delegates to skill.execute() with the original dotted tool name', async () => {
    jest.spyOn(domain.skill, 'execute').mockResolvedValue({ files: [] });

    const result = await domain.execute({
      tool: 'google_docs_list',
      params: { q: 'quarterly report' },
    });

    expect(domain.skill.execute).toHaveBeenCalledWith('google.docs.list', {
      q: 'quarterly report',
    });
    expect(result).toEqual({ files: [] });
  });

  test('falls back to a default empty config/console logger when agentOS is not provided', () => {
    expect(() => new GoogleWorkspaceDomain()).not.toThrow();
  });
});
