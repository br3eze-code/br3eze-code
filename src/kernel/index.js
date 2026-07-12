/**
 * src/kernel/index.js — Kernel namespace root
 * ─────────────────────────────────────────────────────────────────
 * Everything exported here must be domain-agnostic: no MikroTik,
 * Dahua, payment-gateway, or any other Driver-specific import.
 * Drivers live under /src/drivers and depend on the Kernel — never
 * the reverse.
 * ─────────────────────────────────────────────────────────────────
 */

import AgentKernel from '../core/agentKernel.js';
import { SkillDiscovery, SkillDiscoveryError } from './SkillDiscovery.js';

export { AgentKernel, SkillDiscovery, SkillDiscoveryError };
