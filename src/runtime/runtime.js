/**
 * Legacy runtime compatibility facade.
 *
 * Canonical execution authority: ../core/agentRuntime.js.
 * This module preserves the historical runtime API while delegating all
 * executable tool calls to AgentRuntime. It must not own a second executor.
 */
import { AgentRuntime } from '../core/agentRuntime.js';
import { ToolRegistry } from '../core/ToolRegistry.js';

export class Runtime {
    constructor({ llm = null, persona = '', logger = null, toolPolicy = null, toolExecutor = null, agentRuntime = null, toolRegistry = null } = {}) {
        this.llm = llm;
        this.basePersona = persona;
        this.log = logger || { info() {}, warn() {}, debug() {} };
        this.registry = toolRegistry || new ToolRegistry();
        this.agentRuntime = agentRuntime || new AgentRuntime({
            toolRegistry: this.registry,
            logger: this.log,
            toolExecutor,
            permissionPolicy: toolPolicy,
        });
    }

    use(skillOrArray) {
        const skills = Array.isArray(skillOrArray) ? skillOrArray : [skillOrArray];
        for (const skill of skills) this.registry.registerSkill(skill);
        return this;
    }

    tool(tool) {
        this.registry.registerTool(tool);
        return this;
    }

    systemPrompt() {
        const parts = [this.basePersona].filter(Boolean);
        for (const skill of this.registry.listSkills()) {
            if (skill.persona) parts.push(skill.persona);
        }
        const tools = this.registry.getAllTools()
            .map((tool) => `- ${tool.fullName || tool.name}: ${tool.description || ''}`)
            .join('\\n');
        if (tools) parts.push(`Available tools:\\n${tools}`);
        return parts.join('\\n\\n');
    }

    _specialist(context = {}, tool) {
        return context.specialist || {
            id: context.agentId || context.agentRole || tool?.specialist || 'runtime',
            role: context.agentRole || context.role || tool?.specialist || 'runtime',
            ticketTypes: context.ticketTypes || [],
        };
    }

    async _invoke(name, args = {}, context = {}) {
        const tool = this.registry.getTool(name);
        if (!tool) return { type: 'error', tool: name, result: `Unknown tool: ${name}` };

        try {
            const result = await this.agentRuntime.executeTool(name, args, {
                ...context,
                specialist: this._specialist(context, tool),
            });
            return { type: 'tool', tool: name, result };
        } catch (error) {
            return { type: 'error', tool: name, result: error.message };
        }
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
            } catch (error) {
                return { tier: 3, type: 'error', result: `Reasoning failed: ${error.message}` };
            }

            if (decision?.tool) {
                return { tier: 3, ...(await this._invoke(decision.tool, decision.args || {}, context)) };
            }
            if (typeof decision?.text === 'string') {
                return { tier: 3, type: 'chat', result: decision.text };
            }
        }

        const skills = this.registry.listSkills().map((skill) => skill.name).join(', ') || 'none';
        return {
            tier: 0,
            type: 'fallback',
            result: `I couldn't map that to an action. Loaded skills: ${skills}.`,
        };
    }
}

export function createRuntime(opts = {}) {
    return new Runtime(opts);
}
