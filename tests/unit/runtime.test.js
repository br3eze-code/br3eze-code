'use strict';
/**
 * Domain-agnostic runtime: skills compose onto a network-unaware core, and the
 * MikroTik network domain is proven to be just one plugin among arbitrary ones.
 */

const fs = require('fs');
const path = require('path');
const { createRuntime, defineSkill, defineTool } = require('../../src/runtime');
const { createMikrotikSkill } = require('../../src/runtime/skills/mikrotik');

function build() {
    const echo = defineSkill({
        name: 'echo',
        tools: [defineTool({ name: 'echo.say', description: 'echo text', handler: async ({ text }) => `echo: ${text}` })],
        match: (i) => /^say (.+)/i.test(i) ? { tool: 'echo.say', args: { text: i.replace(/^say /i, '') } } : null,
    });
    const calc = defineSkill({
        name: 'calc',
        tools: [defineTool({ name: 'calc.add', description: 'add', handler: async ({ a, b }) => a + b })],
    });
    const mockMt = {
        getActiveUsers: async () => [{ name: 'alice' }, { name: 'bob' }],
        kickUser: async (u) => ({ kicked: u }),
        getSystemStats: async () => ({ 'cpu-load': 7 }),
    };
    const llm = {
        route: async ({ input, tools }) => {
            if (/add/i.test(input)) return { tool: 'calc.add', args: { a: 2, b: 3 } };
            if (/status|stats|cpu/i.test(input)) return { tool: 'network.stats', args: {} };
            return { text: `I have ${tools.length} tools.` };
        },
    };
    const rt = createRuntime({ llm });
    rt.use(echo).use(calc).use(createMikrotikSkill(mockMt));
    return rt;
}

describe('domain-agnostic runtime', () => {
    test('composes arbitrary skills + network-as-plugin', () => {
        const rt = build();
        expect(rt.registry.listSkills()).toHaveLength(3);
        expect(rt.registry.listTools()).toHaveLength(5);
    });

    test('tier-1 fast path for arbitrary and network skills', async () => {
        const rt = build();
        expect((await rt.run('say hello world'))).toMatchObject({ tier: 1, result: 'echo: hello world' });
        expect((await rt.run('who')).result.count).toBe(2);
        expect((await rt.run('kick alice')).result).toEqual({ kicked: 'alice' });
    });

    test('tier-3 LLM routing to registered tools', async () => {
        const rt = build();
        expect((await rt.run('please add 2 and 3'))).toMatchObject({ tier: 3, result: 5 });
        expect((await rt.run('router status')).result['cpu-load']).toBe(7);
        expect((await rt.run('hello there'))).toMatchObject({ type: 'chat' });
    });

    test('unknown tool and empty input degrade gracefully', async () => {
        const rt = createRuntime({});
        expect((await rt.run('')).type).toBe('noop');
        expect((await rt.run('do something')).type).toBe('fallback');
    });

    test('runtime core has no domain coupling (only requires ./registry)', () => {
        const core = fs.readFileSync(path.join(__dirname, '../../src/runtime/runtime.js'), 'utf8');
        const reg = fs.readFileSync(path.join(__dirname, '../../src/runtime/registry.js'), 'utf8');
        const requires = (core.match(/require\(['"][^'"]+['"]\)/g) || []);
        expect(requires).toEqual(["require('./registry')"]);
        // strip comments, then assert no domain identifiers in actual code
        const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(/mikrotik|hotspot|\brouter\b|voucher|firebase/i.test(strip(core) + strip(reg))).toBe(false);
    });
});
