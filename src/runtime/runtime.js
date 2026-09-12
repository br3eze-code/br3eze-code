/**
 * Runtime — domain-agnostic agent loop.
 * Skill -> tool resolution is always followed by the same execution boundary.
 */
import { Registry } from './registry.js';
import ToolPolicy from '../core/specialists/ToolPolicy.js';
import ToolExecutor from '../core/specialists/ToolExecutor.js';

export class Runtime {
    constructor({ llm = null, persona = '', logger = null, toolPolicy = null, toolExecutor = null } = {}) {
        this.registry = new Registry();
        this.llm = llm;
        this.basePersona = persona;
        this.log = logger || { info() {}, warn() {}, debug() {} };
        this.toolPolicy = toolPolicy || new ToolPolicy();
        this.toolExecutor = toolExecutor || new ToolExecutor({ policy: this.toolPolicy });
    }

    use(skillOrArray) {
        const skills = Array.isArray(skillOrArray) ? skillOrArray : [skillOrArray];
        for (const s of skills) this.registry.registerSkill(s);
        return this;
    }

    tool(tool) { this.registry.registerTool(tool); return this; }

    systemPrompt() {
        const parts = [this.basePersona].filter(Boolean);
        for (const s of this.registry.listSkills()) if (s.persona) parts.push(s.persona);
        const tools = this.registry.listTools().map((t) => `- ${t.name}: ${t.description}`).join('\n');
        if (tools) parts.push(`Available tools:\n${tools}`);
        return parts.join('\n\n');
    }

    _specialist(context = {}, tool) {
        return context.specialist || {
            id: context.agentId || context.agentRole || tool.specialist || 'runtime',
            role: context.agentRole || context.role || tool.specialist || 'runtime',
            ticketTypes: context.ticketTypes || [],
        };
    }

    async _invoke(name, args = {}, context = {}) {
        const tool = this.registry.getTool(name);
        if (!tool) return { type: 'error', tool: name, result: `Unknown tool: ${name}` };
        const specialist = this._specialist(context, tool);
        const execution = await this.toolExecutor.execute({
            specialist,
            tool,
            args,
            context,
            ticketType: context.ticketType || null,
            correlationId: context.correlationId || context.interactionId || null,
            taskId: context.taskId || context.ticketId || null,
        });
        return execution.success
            ? { type: 'tool', tool: name, result: execution.data, execution }
            : { type: 'error', tool: name, result: execution.error?.message || 'Tool execution failed', execution };
    }

    async run(input, context = {}) {
        if (!input || !String(input).trim()) return { tier: 0, type: 'noop', result: '' };

        const fast = this.registry.matchFastPath(input);
        if (fast) return { tier: 1, ...(await this._invoke(fast.tool, fast.args, context)) };

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
            if (decision?.tool) return { tier: 3, ...(await this._invoke(decision.tool, decision.args, context)) };
            if (typeof decision?.text === 'string') return { tier: 3, type: 'chat', result: decision.text };
        }

        const skills = this.registry.listSkills().map((s) => s.name).join(', ') || 'none';
        return { tier: 0, type: 'fallback', result: `I couldn't map that to an action. Loaded skills: ${skills}.` };
    }
}

export function createRuntime(opts = {}) { return new Runtime(opts); }
