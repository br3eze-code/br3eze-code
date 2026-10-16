/** Compatibility facade for legacy PascalCase imports.
 * Canonical implementation: ./tool-registry.js
 */
import ToolRegistry, { ToolRegistry as ToolRegistryClass, ToolNotFoundError, SkillDisabledError } from './tool-registry.js';

const registry = new ToolRegistry();
export default registry;
export { ToolRegistryClass as ToolRegistry, ToolNotFoundError, SkillDisabledError };
