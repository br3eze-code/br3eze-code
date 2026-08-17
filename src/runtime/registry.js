/**
 * Registry — the domain-agnostic heart of the AgentOS runtime.
 *
 * The runtime core knows nothing about MikroTik, hotspots, or any specific
 * domain. Capabilities are added as *skills* — self-describing bundles of
 * tools — registered here at startup. This is the plugin model that lets the
 * same runtime power a network agent, a shop agent, or anything else.
 *
 * Architecture inspired by the Claw-family agent runtimes (PicoClaw/OpenClaw,
 * MIT) — reimplemented for AgentOS. A tool is a named function with a JSON
 * schema; a skill groups tools and may expose fast-path matchers so common
 * requests skip the LLM.
 */

export class Registry {
    constructor() {
        this.tools = new Map();     // name -> tool
        this.skills = new Map();    // name -> skill
        this.matchers = [];         // { skill, match } fast-path rules
    }

    /** Register a single tool: { name, description, parameters, handler }. */
    registerTool(tool) {
        if (!tool || !tool.name || typeof tool.handler !== 'function') {
            throw new Error('registerTool requires { name, handler }');
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
            handler: tool.handler,
            skill: tool.skill || null,
            specialist: tool.specialist || null,
            permissions: [...new Set(Array.isArray(tool.permissions) ? tool.permissions : [tool.permissions].filter(Boolean))],
            ticketTypes: [...new Set(Array.isArray(tool.ticketTypes) ? tool.ticketTypes : [tool.ticketTypes].filter(Boolean))],
            risk: tool.risk || 'low',
        });
        return this;
    }

    /**
     * Register a skill: { name, description, tools:[], match? }. Its tools are
     * flattened into the registry; an optional `match(input)` returns
     * `{ tool, args }` for a fast-path (keyword/regex) dispatch.
     */
    registerSkill(skill) {
        if (!skill || !skill.name) throw new Error('registerSkill requires { name }');
        if (this.skills.has(skill.name)) throw new Error(`Skill "${skill.name}" already registered`);
        this.skills.set(skill.name, skill);
        for (const tool of skill.tools || []) {
            this.registerTool({ ...tool, skill: skill.name });
        }
        if (typeof skill.match === 'function') {
            this.matchers.push({ skill: skill.name, match: skill.match });
        }
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
            if (hit && hit.tool && this.tools.has(hit.tool)) {
                return { tool: hit.tool, args: hit.args || {} };
            }
        }
        return null;
    }

    /** Function-calling declarations for the LLM (name/description/schema). */
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
