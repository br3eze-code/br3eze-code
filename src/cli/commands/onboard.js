import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { onboardFleet, onboardRouter } from '../../adapters/network/onboard.js';
import { testConnection as testMikroTikConnection } from '../../adapters/network/mikrotik.js';
import { OAUTH_PROVIDERS } from '../../core/oauth2.js';
import { logger } from '../../core/logger.js';
import winston from 'winston';
import LLMCoordinator from '../../core/llm/LLMCoordinator.js';
import { BaseProvider } from '../../core/llm/providers/BaseProvider.js';
import { AnthropicProvider } from '../../core/llm/providers/AnthropicProvider.js';
import { OpenAIProvider } from '../../core/llm/providers/OpenAIProvider.js';
import { GeminiProvider } from '../../core/llm/providers/GeminiProvider.js';
import { GemmaProvider } from '../../core/llm/providers/GemmaProvider.js';
import { LlamaProvider } from '../../core/llm/providers/LlamaProvider.js';
import { TogetherAIProvider } from '../../core/llm/providers/TogetherAIProvider.js';
import { DeepSeekProvider } from '../../core/llm/providers/DeepSeekProvider.js';
import { GroqProvider } from '../../core/llm/providers/GroqProvider.js';
import { OpenRouterProvider } from '../../core/llm/providers/OpenRouterProvider.js';
import { MoonshotProvider } from '../../core/llm/providers/MoonshotProvider.js';
import { MiniMaxProvider } from '../../core/llm/providers/MiniMaxProvider.js';
import { XAIProvider } from '../../core/llm/providers/XAIProvider.js';
import { OllamaProvider } from '../../core/llm/providers/OllamaProvider.js';

let _clack;
const intro = (...args) => _clack.intro(...args);
const outro = (...args) => _clack.outro(...args);
const note = (...args) => _clack.note(...args);
const spinner = (...args) => _clack.spinner(...args);
const cancel = (...args) => _clack.cancel(...args);
const isCancel = (...args) => _clack.isCancel(...args);
const log = {
  success: (...args) => _clack.log.success(...args), error: (...args) => _clack.log.error(...args),
  warn: (...args) => _clack.log.warn(...args), info: (...args) => _clack.log.info(...args)
};
async function prompt(questions) {
  if (Array.isArray(questions)) questions.forEach(q => { q.message = chalk.cyan('? ') + q.message; });
  else if (typeof questions === 'object') questions.message = chalk.cyan('? ') + questions.message;
  return inquirer.prompt(questions);
}

const DOMAIN_CATALOGUE = {
  mikrotik: { label: 'MikroTik Network Management (hotspot, vouchers, firewall)', requiresAdapter: true, adapterKey: 'mikrotik' },
  linux: { label: 'Linux Server Management (SSH, services, monitoring)', requiresAdapter: false },
  cloud: { label: 'Cloud Infrastructure (AWS / GCP / Azure)', requiresAdapter: false },
  iot: { label: 'IoT / Edge Device Management (MQTT, sensors)', requiresAdapter: false },
  cctv: { label: 'CCTV & Camera Systems (Dahua, Amcrest, Hikvision)', requiresAdapter: true, adapterKey: 'cctv' },
  general: { label: 'General AI Assistant (no specific infrastructure)', requiresAdapter: false },
  codegen: { label: 'Code Generation & AI Coding Assistant', requiresAdapter: false },
  custom: { label: 'Custom / Skip (configure manually later)', requiresAdapter: false }
};
