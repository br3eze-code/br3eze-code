'use strict';

import { jest } from '@jest/globals';

// uuid is an optional peer dep in the test runner environment — mock it
jest.unstable_mockModule('uuid', () => {
    let counter = 0;
    return { v4: () => `mock-uuid-${++counter}` };
});

// AgentRuntime is canonical; only external dependencies are mocked.\n\nconst { AgentRuntime, RuntimeSession, TOOL_MANIFEST, getAgentRuntime } = await import('../../src/core/agentRuntime.js');
const { PermissionMode } = await import('../../src/core/permissions.js');
const { TaskStatus }     = await import('../../src/core/taskRegistry.js');

// ── TOOL_MANIFEST ─────────────────────────────────────────────────────────────

describe('TOOL_MANIFEST', () => {
    test('is a non-empty array', () => {
        expect(Array.isArray(TOOL_MANIFEST)).toBe(true);
        expect(TOOL_MANIFEST.length).toBeGreaterThan(0);
    });

    test('every entry has a name and keywords array', () => {
        for (const entry of TOOL_MANIFEST) {
            expect(typeof entry.name).toBe('string');
            expect(Array.isArray(entry.keywords)).toBe(true);
            expect(entry.keywords.length).toBeGreaterThan(0);
        }
    });

    test('tool names are unique', () => {
        const names = TOOL_MANIFEST.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('expected tools are present', () => {
        const names = new Set(TOOL_MANIFEST.map(t => t.name));
        expect(names.has('system.stats')).toBe(true);
        expect(names.has('user.add')).toBe(true);
        expect(names.has('ping')).toBe(true);
        expect(names.has('firewall.block')).toBe(true);
    });
});

// ── AgentRuntime — routePrompt ────────────────────────────────────────────────

describe('AgentRuntime.routePrompt', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('returns array', () => {
        expect(Array.isArray(runtime.routePrompt('show me the stats'))).toBe(true);
    });

    test('returns empty array for unmatched prompt', () => {
        expect(runtime.routePrompt('xyzzy nonsense gibberish')).toEqual([]);
    });

    test('matches system.stats for stats keywords', () => {
        const tools = runtime.routePrompt('show cpu memory stats');
        expect(tools).toContain('system.stats');
    });

    test('matches ping for ping/latency keywords', () => {
        const tools = runtime.routePrompt('ping this host for latency');
        expect(tools).toContain('ping');
    });

    test('matches firewall.block for block/ban keywords', () => {
        const tools = runtime.routePrompt('block and ban this ip blacklist');
        expect(tools).toContain('firewall.block');
    });

    test('matches user.add for add/create/register keywords', () => {
        const tools = runtime.routePrompt('create a new user and register');
        expect(tools).toContain('user.add');
    });

    test('matches system.reboot for restart/reboot keywords', () => {
        const tools = runtime.routePrompt('reboot and restart the system');
        expect(tools).toContain('system.reboot');
    });

    test('respects limit parameter', () => {
        const tools = runtime.routePrompt('stats memory cpu logs active users connected sessions', 3);
        expect(tools.length).toBeLessThanOrEqual(3);
    });

    test('returns results sorted by descending match score', () => {
        // A prompt with many system.stats keywords should rank it first
        const tools = runtime.routePrompt('cpu memory resource health system stats');
        expect(tools[0]).toBe('system.stats');
    });

    test('is case-insensitive', () => {
        const tools = runtime.routePrompt('PING THE HOST');
        expect(tools).toContain('ping');
    });

    test('ignores punctuation in prompt', () => {
        const tools = runtime.routePrompt('ping! the host...');
        expect(tools).toContain('ping');
    });
});

// ── AgentRuntime — listTools / findTools ─────────────────────────────────────

describe('AgentRuntime.listTools', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('returns all tool names', () => {
        const tools = runtime.listTools();
        expect(tools).toHaveLength(TOOL_MANIFEST.length);
        expect(tools).toContain('ping');
        expect(tools).toContain('user.add');
    });
});

describe('AgentRuntime.findTools', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('finds by name substring', () => {
        const tools = runtime.findTools('firewall');
        expect(tools.length).toBeGreaterThan(0);
        expect(tools.every(t => t.includes('firewall'))).toBe(true);
    });

    test('finds by keyword', () => {
        const tools = runtime.findTools('ban');
        expect(tools).toContain('firewall.block');
    });

    test('returns empty array for no match', () => {
        expect(runtime.findTools('xyzzy123')).toEqual([]);
    });
});

// ── RuntimeSession ────────────────────────────────────────────────────────────

describe('RuntimeSession', () => {
    test('owns canonical session state directly', () => {
        const s = new RuntimeSession({
            prompt: 'test prompt',
            matchedTools: ['ping'],
            permissionDenials: []
        });
        expect(s.prompt).toBe('test prompt');
        expect(typeof s.sessionId).toBe('string');
        expect(s.matchedTools).toEqual(['ping']);
        expect(s.permissionDenials).toEqual([]);
        expect(s.taskId).toBeNull();
        expect(s.enforcer).toBeDefined();
        expect(s.transcriptStore).toBeDefined();
    });

    test('accepts optional taskId', () => {
        const s = new RuntimeSession({
            prompt: 'p', matchedTools: [], permissionDenials: [], taskId: 'task-99'
        });
        expect(s.taskId).toBe('task-99');
    });

    test('has ISO createdAt timestamp', () => {
        const s = new RuntimeSession({
            prompt: 'p', matchedTools: [], permissionDenials: []
        });
        expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt);
    });

    test('asMarkdown returns string containing prompt and session id', () => {
        const s = new RuntimeSession({
            prompt: 'show stats', matchedTools: ['system.stats'], permissionDenials: []
        });
        const md = s.asMarkdown();
        expect(typeof md).toBe('string');
        expect(md).toContain('show stats');
        expect(md).toContain(s.sessionId);
        expect(md).toContain('system.stats');
    });

    test('asMarkdown shows "none" when no tools matched', () => {
        const s = new RuntimeSession({
            prompt: 'gibberish', matchedTools: [], permissionDenials: []
        });
        expect(s.asMarkdown()).toContain('none');
    });

    test('executes a turn without a second execution engine', async () => {
        const executor = jest.fn().mockResolvedValue({ ok: true });
        const s = new RuntimeSession({
            prompt: 'ping', matchedTools: ['ping'], permissionDenials: [],
            config: { toolExecutor: executor }
        });
        const result = await s.submitMessage('ping', ['ping']);
        expect(result.stopReason).toBe('completed');
        expect(result.matchedTools).toEqual(['ping']);
        expect(executor).toHaveBeenCalledWith('ping');
    });
});

describe('AgentRuntime capability ownership', () => {
    test('owns the canonical tool registry and exposes a capability manifest', () => {
        const runtime = new AgentRuntime();
        expect(runtime.toolRegistry).toBeDefined();
        runtime.registerTool({
            name: 'example.lookup',
            description: 'Look up an entity',
            execute: async () => ({ ok: true }),
        });
        const manifest = runtime.getCapabilityManifest();
        expect(manifest.tools.some(tool => tool.name === 'example.lookup')).toBe(true);
    });

    test('loads plugins through the runtime-owned plugin registry', async () => {
        const runtime = new AgentRuntime();
        const plugin = {
            getManifest: () => ({
                id: 'example.plugin',
                version: '1.0.0',
                capabilities: ['example.lookup'],
            }),
            initialize: jest.fn(async function () {
                await this._context?.registerTool?.({
                    name: 'example.lookup',
                    description: 'Plugin-provided lookup',
                    execute: async () => ({ ok: true }),
                });
            }),
            start: jest.fn(async () => {}),
        };
        await runtime.loadPlugin(plugin);
        expect(runtime.pluginRegistry.has('example.plugin')).toBe(true);
        expect(plugin.initialize).toHaveBeenCalled();
        expect(plugin.start).toHaveBeenCalled();
        expect(runtime.listTools()).toContain('example.lookup');
    });
});

// ── getAgentRuntime singleton ─────────────────────────────────────────────────

describe('getAgentRuntime', () => {
    test('returns the same instance on repeated calls', () => {
        const a = getAgentRuntime();
        const b = getAgentRuntime();
        expect(a).toBe(b);
    });

    test('instance is an AgentRuntime', () => {
        expect(getAgentRuntime()).toBeInstanceOf(AgentRuntime);
    });
});
