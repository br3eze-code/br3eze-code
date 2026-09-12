/**
 * Registry — the domain-agnostic heart of the AgentOS runtime.
 *
 * A skill is a capability bundle and a tool is its executable operation.
 * The registry normalizes both `handler` and the skill-native `execute`
 * contracts so callers do not need to know which representation a skill uses.
 */

function normalizeHandler(tool) {
    if (typeof tool?.handler === 'function') return tool.handler;
    if (typeof tool?.execute === 'function') return tool.execute;
    return null;
}

export class Registry {
    constructor() {
        this.tools = new Map();
        this.skills = new Map();
        this.matchers = [];
    }

    /** Register a single executable tool. */
    registerTool(tool) {
        if (!tool || !tool.name) {
            throw new Error('registerTool requires { name, handler|execute }');
        }
        const handler = normalizeHandler(tool);
        if (typeof handler !== 'function') {
            throw new Error(`Tool "${tool.name}" requires a handler or execute function`);
        }
        if (this.tools.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" already registered`);
        }
        this.tools.set(tool.name, {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.parameters || tool.inputSchema || { type: 'object', properties: {} },
            inputSchema: tool.inputSchema || tool.parameters || { type: 'object', properties: {} },
            outputSchema: tool.outputSchema || null,
            handler,
            skill: tool.skill || null,
            specialist: tool.specialist || null,
            permissions: [...new Set(Array.isArray(tool.permissions) ? tool.permissions : [tool.permissions].filter(Boolean))],
            ticketTypes: [...new Set(Array.isArray(tool.ticketTypes) ? tool.ticketTypes : [tool.ticketTypes].filter(Boolean))],
            risk: tool.risk || 'low',
        });
        return this;
    }

    /** Register a skill and flatten its executable tools. */
    registerSkill(skill) {
        if (!skill || !skill.name) throw new Error('registerSkill requires { name }');
        if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" already registered`);
        this.skills.set(skill.name, skill);
        for (const tool of skill.tools || []) this.registerTool({ ...tool, skill: skill.name });
        if (typeof skill.match === 'function') this.matchers.push({ skill: skill.name, match: skill.match });
        return this;
    }

    getTool(name) { return this.tools.get(name) || null; }
    listTools() { return [...this.tools.values()]; }
    listSkills() { return [...this.skills.values()]; }

    /** Try every skill's fast-path matcher; first hit wins. */
    matchFastPath(input) {
        for (const { match } of this.matchers) {
            let hit;
            try { hit = match(input); } catch { hit = null; }
            if (hit && hit.tool && this.tools.has(hit.tool)) return { tool: hit.tool, args: hit.args || {} };
        }
        return null;
    }

    /** Function-calling declarations for the LLM. */
    toolDeclarations() {
        return this.listTools().map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            inputSchema: t.inputSchema,
            outputSchema: t.outputSchema,
            specialist: t.specialist,
            permissions: t.permissions,
            ticketTypes: t.ticketTypes,
            risk: t.risk,
        }));
    }
}
