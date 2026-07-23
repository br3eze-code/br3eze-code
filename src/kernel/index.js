'use strict';
/**
 * src/kernel/index.js — Kernel namespace root
 * ─────────────────────────────────────────────────────────────────
 * Everything exported here must be domain-agnostic: no MikroTik,
 * Dahua, payment-gateway, or any other Driver-specific import.
 * Drivers live under /src/drivers and depend on the Kernel — never
 * the reverse.
 * ─────────────────────────────────────────────────────────────────
 */

const AgentKernel = require('../core/agentKernel');
const { SkillDiscovery, SkillDiscoveryError } = require('./SkillDiscovery');

module.exports = { AgentKernel, SkillDiscovery, SkillDiscoveryError };