/**
 * Canonical context boundary for AgentOS.
 *
 * Context construction remains implemented by the existing pure normalizers;
 * this class provides one stable runtime-facing API so callers do not need to
 * know which context variant or compatibility helper performs the work.
 */
import {
  buildExecutionContext,
  buildChannelExecutionContext,
  withExecutionContext,
} from '../execution-context.js';

export class ContextEngine {
  constructor({ channelAware = true } = {}) {
    this.channelAware = channelAware;
  }

  build(input = {}, options = {}) {
    const useChannelContext = options.channelAware ?? this.channelAware;
    return useChannelContext
      ? buildChannelExecutionContext(input)
      : buildExecutionContext(input);
  }

  patch(context = {}, patch = {}, options = {}) {
    const useChannelContext = options.channelAware ?? false;
    if (!useChannelContext) return withExecutionContext(context, patch);
    return this.build({ ...context, ...patch, userDoc: patch.userDoc || context?.userDoc }, { channelAware: true });
  }

  summarize(context = {}) {
    return {
      userId: context.userId || null,
      tenantId: context.tenantId || null,
      siteId: context.siteId || null,
      nodeId: context.nodeId || null,
      channel: context.channel || 'unknown',
      domain: context.domain || 'general',
      role: context.role || 'user',
      roles: Array.isArray(context.roles) ? [...context.roles] : [],
    };
  }
}

export const createContextEngine = (options) => new ContextEngine(options);

export default ContextEngine;
