import { ToolRegistry } from '../../src/core/tool-registry.js';

describe('ToolRegistry tool declaration metadata', () => {
  test('preserves top-level description, parameters, and returns', () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    const parameters = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };
    const returns = { type: 'object', properties: { results: { type: 'array' } } };

    registry.register('demo.search', {
      description: 'Search the demo index',
      parameters,
      returns,
      handler: async () => ({ results: [] }),
    });

    expect(registry.getTool('demo.search').schema).toMatchObject({
      description: 'Search the demo index',
      parameters,
      returns,
    });
  });

  test('nested schema values take precedence over top-level metadata', () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    const nestedParameters = { type: 'object', properties: { id: { type: 'string' } } };

    registry.register('demo.lookup', {
      description: 'Top-level description',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      schema: {
        description: 'Nested description',
        parameters: nestedParameters,
      },
      handler: async () => ({}),
    });

    expect(registry.getTool('demo.lookup').schema.description).toBe('Nested description');
    expect(registry.getTool('demo.lookup').schema.parameters).toEqual(nestedParameters);
  });
});
