import { EventEmitter } from 'node:events';
import { A2AProtocolAdapter } from './a2a-adapter.js';

class A2APlugin extends EventEmitter {
    constructor() {
        super();
        this.adapters = new Map();
        this.agentKeys = new Map();
    }

    async onBootstrap(ctx) {
        this.ctx = ctx;
        ctx.logger.info('A2A protocol plugin loaded');
    }

    _setAdapter(agent, spiffeID, adapter) {
        const agentId = String(agent.id);
        this.adapters.set(agentId, adapter);
        this.adapters.set(spiffeID, adapter);
        this.agentKeys.set(agentId, spiffeID);
    }

    _getAdapter(identifier) {
        return this.adapters.get(identifier) || this.adapters.get(decodeURIComponent(identifier)) || null;
    }

    async onAgentInit(ctx, agent) {
        const pluginConfig = agent.config?.plugins?.['@br3eze/a2a-protocol'];
        if (!pluginConfig) return;

        const spiffeID = pluginConfig.spiffeID || `spiffe://br3eze.local/agent/${agent.id}`;
        const adapter = new A2AProtocolAdapter({
            spiffeID,
            trustedAgents: pluginConfig.trustedAgents || [],
            mTLS: {
                enabled: pluginConfig.mTLS?.enabled ?? true,
                certPath: pluginConfig.mTLS?.certPath || '/spiffe/certs'
            },
            modelArmor: pluginConfig.modelArmor || {},
            rateLimiting: pluginConfig.rateLimiting || {},
            sessionTTL: pluginConfig.sessionTTL || 3600000,
            protocolVersion: pluginConfig.protocolVersion || '1.0'
        });

        const capabilities = agent.capabilities instanceof Map
            ? agent.capabilities.entries()
            : Object.entries(agent.capabilities || {});
        for (const [name, cap] of capabilities) {
            adapter.registerCapability(name, {
                description: cap.description,
                inputSchema: cap.inputSchema,
                version: cap.version || '1.0'
            }, cap.handler, cap.streamingHandler);
        }

        for (const trusted of pluginConfig.trustedAgents || []) {
            if (trusted.spiffeID && trusted.endpoint) {
                adapter.transport.registerEndpoint(trusted.spiffeID, trusted.endpoint);
            }
        }

        adapter.on('task:sent', (event) => ctx.metrics?.increment?.('a2a.task.sent', event));
        adapter.on('task:complete', (event) => ctx.metrics?.histogram?.('a2a.task.duration', event.duration));
        adapter.on('task:error', () => ctx.metrics?.increment?.('a2a.task.error'));

        await adapter.initialize();
        this._setAdapter(agent, spiffeID, adapter);
        agent.a2a = adapter;
        ctx.logger.info(`A2A initialized for agent ${agent.id} as ${spiffeID}`);
    }

    async onRegisterRoutes(ctx, router) {
        router.post('/a2a/:agentId', async (req, res) => {
            try {
                const adapter = this._getAdapter(req.params.agentId);
                if (!adapter) {
                    return res.status(404).json({
                        type: 'ERROR',
                        error: { code: 'NOT_FOUND', message: `Agent ${req.params.agentId} not found or A2A not enabled` }
                    });
                }
                const response = await adapter.handleIncomingMessage(req.body);
                const status = response?.type === 'ERROR' && response.error?.code === 'INTERNAL' ? 500 : 200;
                return res.status(status).json(response);
            } catch (error) {
                ctx.logger.error(`A2A route error: ${error.message}`);
                return res.status(500).json({ type: 'ERROR', error: { code: 'INTERNAL', message: error.message } });
            }
        });
        ctx.logger.info('Registered route POST /a2a/:agentId');
    }

    async onCapabilityRegister(ctx, agent, name, def) {
        const adapter = this._getAdapter(String(agent.id));
        const capability = agent.capabilities instanceof Map ? agent.capabilities.get(name) : agent.capabilities?.[name];
        if (adapter && capability) adapter.registerCapability(name, def, capability.handler, capability.streamingHandler);
    }
}

export default new A2APlugin();
export { A2APlugin };
