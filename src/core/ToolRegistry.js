/**
 * Compatibility facade for legacy PascalCase imports.
 *
 * Canonical implementation: ./tool-registry.js
 * Keep this file thin so there is exactly one ToolRegistry implementation.
 */
import ToolRegistry, {
  ToolRegistry as ToolRegistryClass,
  ToolNotFoundError,
  SkillDisabledError,
} from './tool-registry.js';

const registry = new ToolRegistry();

export default registry;
export {
  ToolRegistryClass as ToolRegistry,
  ToolNotFoundError,
  SkillDisabledError,
};
