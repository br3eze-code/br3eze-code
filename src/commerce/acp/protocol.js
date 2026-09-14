export const ACP_ADAPTER_VERSION = '2026-04-17';

/**
 * Protocol-specific transport/authentication belongs here or in sibling adapters.
 * Domain commerce services must remain protocol-neutral.
 */
export function createProtocolEnvelope({ type, payload, requestId = null } = {}) {
  if (!type) throw new Error('Protocol message type is required.');
  return {
    protocol: 'agentic-commerce',
    version: ACP_ADAPTER_VERSION,
    type,
    requestId,
    payload,
  };
}
