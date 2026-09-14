import { OrganisationMatrix } from '../../src/core/organisation-matrix.js';

describe('OrganisationMatrix', () => {
  test('assigns by capability, authority, scope and capacity', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const matrix = new OrganisationMatrix({ audit });

    matrix.register({
      id: 'example-specialist',
      capabilities: ['example.execute'],
      authority: ['example.write'],
      scope: ['example.resource'],
      capacity: 1,
      active: 0,
      execute: async () => ({ ok: true }),
    });

    const assignment = await matrix.assign({
      id: 'work-1',
      capability: 'example.execute',
      authority: 'example.write',
      scope: 'example.resource',
    });

    expect(assignment.specialistId).toBe('example-specialist');
    const result = await matrix.execute(assignment, { id: 'work-1' });
    expect(result).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'assignment.created' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'assignment.completed' }));
  });

  test('does not assign when capacity is exhausted', async () => {
    const matrix = new OrganisationMatrix();
    matrix.register({
      id: 'busy',
      capabilities: ['example.execute'],
      authority: ['example.write'],
      capacity: 1,
      active: 1,
      execute: async () => ({ ok: true }),
    });

    await expect(matrix.assign({ id: 'work-2', capability: 'example.execute' })).resolves.toBeNull();
  });

  test('policy can deny assignment without executing a specialist', async () => {
    const execute = jest.fn();
    const matrix = new OrganisationMatrix({
      policy: { authorize: async () => false },
    });
    matrix.register({ id: 'denied', capabilities: ['example.execute'], execute });

    const assignment = await matrix.assign({ id: 'work-3', capability: 'example.execute' });
    expect(assignment).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
