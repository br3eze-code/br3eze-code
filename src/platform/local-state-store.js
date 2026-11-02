/**
 * Compatibility export. Node filesystem persistence is implemented only by
 * the persistence adapter; platform/core code consumes its storage contract.
 */
export { LocalStateStore as default, LocalStateStore } from '../adapters/persistence/local-state-store.js';
