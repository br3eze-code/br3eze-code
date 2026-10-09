/**
 * Backward-compatible entry point.
 * Canonical SDK implementation lives in src/sdk/plugin/.
 */
export * from '../sdk/plugin/index.js';
import * as sdk from '../sdk/plugin/index.js';
export default sdk;
