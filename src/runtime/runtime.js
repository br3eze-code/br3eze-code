/**
 * Runtime — the domain-agnostic agent loop.
 *
 * createRuntime({ llm, persona }) returns a Runtime you extend with skills:
 *
 *     const rt = createRuntime({ llm });
 *     rt.use(networkSkill).use(shopSkill);
 *     await rt.run('who is online');
 *
 * run() dispatches in tiers, over the *registered* tools (nothing hardcoded):
 *   Tier 1  — a skill's fast-path matcher resolves input → a tool call
 *   Tier 3  — the LLM chooses a tool + args (or replies in prose)
 * The core has zero domain knowledge; MikroTik/shop/etc. are just skills.
 *
 * The `llm` is an adapter with an optional async `route({ system, input, tools })`
 * returning `{ tool, args }` (call a tool) or `{ text }` (prose reply). Absent
 * an llm, only the fast paths work and everything else returns guidance.
 */

import { Registry } from './registry.js';

export class Runtime {
    constructor({ llm = null, persona = '', logger = null } = {}) {
        this.registry = new Registry();
        this.llm = llm;
        this.basePersona = persona;
        this.log = logger || { info() {}, warn() {}, debug() {} };
    }

    /** Add a skill (from defineSkill) or an array of skills. */
    use(skillOrArray) {
        const skills = Array.isArray(skillOrArray) ? skillOrArray : [skillOrArray];
        for (const s of skills) this.registry.registerSkill(s);
        return this;
    }

    /** Add a single tool (from defineTool). */
    tool(tool) { this.registry.registerTool(tool); return this; }

    /** Assemble the system prompt: base persona + each skill's persona. */
    systemPrompt() {
        const parts = [this.basePersona].filter(Boolean);
        for (const s of this.registry.listSkills()) if (s.persona) parts.push(s.persona);
        const tools = this.registry.listTools().map((t) => `- ${t.name}: ${t.description}`).join('\n');
        if (tools) parts.push(`Available tools:\n${tools}`);
        return parts.join('\n\n');
    }

    async _invoke(name, args, context) {
        const tool = this.registry.getTool(name);
        if (!tool) return { type: 'error', result: `Unknown tool: ${name}` };
        const executionContext = context || {};
        const granted = new Set(executionContext.authorizedCapabilities || executionContext.permissions || []);
        const required = tool.permissions || [];
        if (required.some((permission) => !granted.has(permission))) {
            return { type: 'error', tool: name, result: `Permission denied for ${name}` };
        }
        if (tool.specialist) {
            const role = executionContext.agentRole || executionContext.role;
            if (!role || String(role).trim().toLowerCase() !== String(tool.specialist).trim().toLowerCase()) {
                return { type: 'error', tool: name, result: `Specialist role required for ${name}: ${tool.specialist}` };
            }
        }
        try {
            const result = await tool.handler(args || {}, executionContext);
            return { type: 'tool', tool: name, result };
        } catch (e) {
            return { type: 'error', tool: name, result: e.message };
        }
    }

    /**
     * Run one turn. Returns { tier, type, result, [tool] }.
     * @param {string} input
     * @param {object} [context]  passed to tool handlers (user, channel, deps…)
     */
    async run(input, context = {}) {
        if (!input || !String(input).trim()) return { tier: 0, type: 'noop', result: '' };

        // Tier 1 — deterministic fast path.
        const fast = this.registry.matchFastPath(input);
        if (fast) {
            const r = await this._invoke(fast.tool, fast.args, context);
            return { tier: 1, ...r };
        }

        // Tier 3 — LLM chooses a tool or answers.
        if (this.llm && typeof this.llm.route === 'function') {
            let decision;
            try {
                decision = await this.llm.route({
                    system: this.systemPrompt(),
                    input,
                    tools: this.registry.toolDeclarations(),
                    context,
                });
            } catch (e) {
                return { tier: 3, type: 'error', result: `Reasoning failed: ${e.message}` };
            }
            if (decision && decision.tool) {
                const r = await this._invoke(decision.tool, decision.args, context);
                return { tier: 3, ...r };
            }
            if (decision && typeof decision.text === 'string') {
                return { tier: 3, type: 'chat', result: decision.text };
            }
        }

        // No llm / no decision — degrade gracefully with guidance.
        const skills = this.registry.listSkills().map((s) => s.name).join(', ') || 'none';
        return {
            tier: 0,
            type: 'fallback',
            result: `I couldn't map that to an action. Loaded skills: ${skills}.`,
        };
    }
}

export function createRuntime(opts = {}) { return new Runtime(opts); }
