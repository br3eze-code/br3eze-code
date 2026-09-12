export class A2AAdapter {
  constructor({ client, authorize = null } = {}) {
    if (!client) throw new TypeError('A2A_CLIENT_REQUIRED');
    this.client = client;
    this.authorize = authorize;
  }

  async sendTask({ agent, input, context = {}, metadata = {} }) {
    await this._authorize('a2a.task.send', context, { agent });
    return this.client.sendTask({ agent, input, context: { ...context, tenantId: context.tenantId }, metadata });
  }

  async getTask(taskId, context = {}) {
    await this._authorize('a2a.task.read', context, { taskId });
    return this.client.getTask(taskId);
  }

  async cancelTask(taskId, context = {}) {
    await this._authorize('a2a.task.cancel', context, { taskId });
    return this.client.cancelTask(taskId);
  }

  async _authorize(capability, context, resource) {
    if (!context.tenantId) throw new Error('TENANT_SCOPE_REQUIRED');
    if (this.authorize) {
      const allowed = await this.authorize({ capability, tenantId: context.tenantId, userId: context.userId, resource });
      if (!allowed) throw new Error('CAPABILITY_FORBIDDEN');
    }
  }
}
