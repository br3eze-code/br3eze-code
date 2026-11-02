import { ApplicationManager } from './ApplicationManager.js';
import { IPCMessageBus } from './IPCMessageBus.js';
import { ServiceSupervisor } from './ServiceSupervisor.js';

/**
 * Compose the managed application layer around the existing AgentRuntime.
 * This is lifecycle, IPC and state plumbing—not a second agent execution loop
 * or a process/security sandbox.
 */
export function createManagedPlatform({
  stateStore = null,
  authorizeIpc,
  onServiceEvent,
  onIpcAudit,
  maxServices,
  maxSubscribers,
  maxPayloadBytes,
} = {}) {
  if (stateStore !== null) {
    for (const method of ['get', 'set', 'delete', 'list']) {
      if (typeof stateStore[method] !== 'function') {
        throw new TypeError(`stateStore must implement ${method}()`);
      }
    }
  }

  const supervisor = new ServiceSupervisor({
    ...(maxServices === undefined ? {} : { maxServices }),
    ...(onServiceEvent === undefined ? {} : { onEvent: onServiceEvent }),
  });
  const applications = new ApplicationManager({ supervisor });
  const ipc = new IPCMessageBus({
    ...(maxSubscribers === undefined ? {} : { maxSubscribers }),
    ...(maxPayloadBytes === undefined ? {} : { maxPayloadBytes }),
    ...(authorizeIpc === undefined ? {} : { authorize: authorizeIpc }),
    ...(onIpcAudit === undefined ? {} : { onAudit: onIpcAudit }),
  });

  return Object.freeze({ supervisor, applications, ipc, stateStore });
}

export { ApplicationManager } from './ApplicationManager.js';
export { IPCMessageBus } from './IPCMessageBus.js';
export { ServiceSupervisor } from './ServiceSupervisor.js';
export default createManagedPlatform;
