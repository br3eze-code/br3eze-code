import { randomUUID } from 'node:crypto';

export class AgentSupervisor {
  constructor({ maxDepth = 4, maxChildren = 32, maxConcurrent = 8 } = {}) {
    this.maxDepth = maxDepth; this.maxChildren = maxChildren; this.maxConcurrent = maxConcurrent;
    this.children = new Map();
  }
  spawn(parent, { tenantId, userId, capabilities = [], depth = (parent?.depth || 0) + 1, run }) {
    if (!tenantId || !userId) throw new Error('tenantId and userId are required');
    if (parent && (tenantId !== parent.tenantId || userId !== parent.userId)) throw new Error('Child execution scope cannot escape parent identity');
    if (depth > this.maxDepth) throw new Error(`Maximum agent depth ${this.maxDepth} exceeded`);
    const id = randomUUID();
    const inherited = new Set(parent?.capabilities || []);
    const allowed = capabilities.filter(cap => inherited.size === 0 || inherited.has(cap));
    const child = Object.freeze({ id, parentId: parent?.id || null, tenantId, userId, depth, capabilities: allowed });
    if (this.children.size >= this.maxChildren) throw new Error('Maximum child-agent count exceeded');
    this.children.set(id, child);
    return run ? run(child) : child;
  }
  async concurrent(jobs, { maxConcurrent = this.maxConcurrent, failFast = false } = {}) {
    const results = new Array(jobs.length); let cursor = 0;
    const worker = async () => { while (true) { const i = cursor++; if (i >= jobs.length) return; try { results[i] = { status: 'fulfilled', value: await jobs[i]() }; } catch (error) { results[i] = { status: 'rejected', reason: error }; if (failFast) throw error; } } };
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, jobs.length) }, worker));
    return results;
  }
  stop(id) { return this.children.delete(id); }
  get(id) { return this.children.get(id) || null; }
}
