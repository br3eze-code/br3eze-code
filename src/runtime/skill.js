/**
 * Skill/tool definition helpers + a filesystem skill loader.
 *
 * Skills are the unit of extensibility. Define them in code with defineSkill(),
 * or drop a directory containing SKILL.md (+ optional index.js exporting a
 * skill) and load it with loadSkillsFrom() — no runtime-core changes needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Define a tool: a named, schema-described function. */
export function defineTool({ name, description = '', parameters, handler }) {
    if (!name || typeof handler !== 'function') throw new Error('defineTool requires { name, handler }');
    return { name, description, parameters: parameters || { type: 'object', properties: {} }, handler };
}

/**
 * Define a skill.
 * @param {object} def
 * @param {string} def.name
 * @param {string} [def.description]
 * @param {Array}  [def.tools]      tools (from defineTool)
 * @param {Function} [def.match]    (input) => { tool, args } | null  — fast path
 * @param {string} [def.persona]    text appended to the system prompt
 */
export function defineSkill(def) {
    if (!def || !def.name) throw new Error('defineSkill requires { name }');
    return {
        name: def.name,
        description: def.description || '',
        tools: def.tools || [],
        match: def.match || null,
        persona: def.persona || '',
    };
}

/**
 * Discover skills under a directory. Each subdirectory may contain:
 *   - index.js exporting a skill object (or { skill } / default), and/or
 *   - SKILL.md whose front-matter/first heading provides name + description.
 * Code skills win; a SKILL.md-only directory becomes a persona-only skill.
 */
export function discoverSkillMetadata(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => {
            const md = path.join(dir, entry.name, 'SKILL.md');
            if (!fs.existsSync(md)) return null;
            const meta = _parseSkillMd(fs.readFileSync(md, 'utf8'), entry.name);
            return {
                name: meta.name,
                description: meta.description,
                path: path.join(dir, entry.name),
                activated: false,
            };
        })
        .filter(Boolean);
}

export function loadSkillsFrom(dir) {
    const skills = [];
    if (!fs.existsSync(dir)) return skills;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sub = path.join(dir, entry.name);
        const idx = ['index.js', 'skill.js'].map((f) => path.join(sub, f)).find((f) => fs.existsSync(f));
        if (idx) {
            try {
                const mod = require(idx);
                const skill = mod && (mod.skill || mod.default || (mod.name ? mod : null));
                if (skill && skill.name) { skills.push(skill); continue; }
            } catch (e) { /* fall through to SKILL.md */ }
        }
        const md = path.join(sub, 'SKILL.md');
        if (fs.existsSync(md)) {
            const meta = _parseSkillMd(fs.readFileSync(md, 'utf8'), entry.name);
            skills.push(defineSkill({ name: meta.name, description: meta.description, persona: meta.persona }));
        }
    }
    return skills;
}

function _parseSkillMd(text, fallbackName) {
    let name = fallbackName, description = '';
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
        const n = fm[1].match(/^name:\s*(.+)$/m);
        const d = fm[1].match(/^description:\s*(.+)$/m);
        if (n) name = n[1].trim();
        if (d) description = d[1].trim();
    } else {
        const h = text.match(/^#\s+(.+)$/m);
        if (h) name = h[1].trim();
    }
    return { name, description, persona: text.slice(0, 2000) };
}
