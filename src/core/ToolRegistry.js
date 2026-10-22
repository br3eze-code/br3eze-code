/**
 * Compatibility facade for legacy PascalCase imports.
 *
 * The canonical implementation lives in ./tool-registry.js. This module
 * preserves the historical singleton default export while sharing the same
 * implementation for named imports.
 */
import ToolRegistry, {
  ToolRegistry as ToolRegistryClass,
  ToolNotFoundError,
  SkillDisabledError,
  CapabilityBoundaryError,
} from './tool-registry.js';

const registry = new ToolRegistry();

export default registry;
export {
  ToolRegistryClass as ToolRegistry,
  ToolNotFoundError,
  SkillDisabledError,
  CapabilityBoundaryError,
};
