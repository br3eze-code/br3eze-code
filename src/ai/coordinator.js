// src/ai/coordinator.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import EventEmitter from 'events';
import { logger } from '../core/logger.js';
import { DEFAULT_LOGIN_DOMAIN } from '../core/config.js';

import { QNAPProcessor } from './qnap-integration.js';
import SkillRegistry from '../core/skills/SkillRegistry.js';
import { getManager } from '../core/mikrotik.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, DEFAULT_PLANS } from '../core/database.js';
import voucherAgent from '../core/voucher.js';
import QRCode from 'qrcode';
import { getUserSandbox } from '../core/userSandbox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AICoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.skillRegistry = new SkillRegistry();
    this.qnap = new QNAPProcessor();
    this.conversationContext = new Map(); // Context per user
    this.toolRegistry = new Map();
    this.toolToSkillMap = new Map(); // toolName -> skillName

    // Inject MikroTik Manager
    this.mikrotik = getManager();

    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: this.getSystemPrompt(),
    });

    this._registerStaticTools();
    this._initSkills();
  }

  async _initSkills() {
    const skillsPath = path.join(__dirname, '../skills');
    await this.skillRegistry.loadFromDirectory(skillsPath, this.config);

    // Build tool-to-skill map — check both manifest.tools AND static getTools() on the class
    for (const manifest of this.skillRegistry.list()) {
      const skillName = manifest.name;

      // 1. Tools declared in the manifest (skill.json "tools" array)
      if (manifest.tools) {
        if (Array.isArray(manifest.tools)) {
          manifest.tools.forEach(t => this.toolToSkillMap.set(t.name, skillName));
        } else {
          Object.keys(manifest.tools).forEach(tn => this.toolToSkillMap.set(tn, skillName));
        }
      }

      // 2. Tools declared on the skill class via static getTools() (the common pattern —
      //    21 of 23 skills use this and have nothing in manifest.tools)
      const impl = this.skillRegistry.implementations?.get(skillName);
      if (impl && typeof impl.getTools === 'function') {
        const classTools = impl.getTools();
        Object.keys(classTools).forEach(tn => this.toolToSkillMap.set(tn, skillName));
      }
    }

    logger.info(
      `AICoordinator: Loaded ${this.skillRegistry.skills.size} skills and ${this.toolToSkillMap.size} tools`
    );

    // Refresh model with full function declarations after skills are loaded
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: this.getSystemPrompt(),
      tools: [{ functionDeclarations: this._buildFunctionDeclarations() }],
    });
  }

  /** Build Gemini-native function declarations from all registered tools */
  _buildFunctionDeclarations() {
    const decls = [];
    this.toolRegistry.forEach((tool, name) => {
      decls.push({
        name: name.replace(/\./g, '__'),
        description: tool.description || name,
        parameters: this._normalizeParams(tool.parameters),
      });
    });
    if (this.skillRegistry) {
      for (const manifest of this.skillRegistry.list()) {
        const impl = this.skillRegistry.implementations?.get(manifest.name);
        const classTools = impl && typeof impl.getTools === 'function' ? impl.getTools() : {};
        const manifestTools = manifest.tools || {};
        const allTools = Array.isArray(manifestTools)
          ? Object.fromEntries(manifestTools.map(t => [t.name, t]))
          : { ...manifestTools, ...classTools };
        for (const [toolName, tool] of Object.entries(allTools)) {
          decls.push({
            name: toolName.replace(/\./g, '__'),
            description: tool.description || toolName,
            parameters: this._normalizeParams(tool.parameters),
          });
        }
      }
    }
    return decls;
  }

  _normalizeParams(params) {
    if (!params) return { type: 'OBJECT', properties: {}, required: [] };
    if (params.type === 'object' || params.type === 'OBJECT') {
      const props = {};
      for (const [k, v] of Object.entries(params.properties || {})) {
        props[k] = { type: (v.type || 'STRING').toUpperCase(), description: v.description || k };
      }
      return { type: 'OBJECT', properties: props, required: params.required || [] };
    }
    return { type: 'OBJECT', properties: {}, required: [] };
  }

  getSystemPrompt() {
    return `You are AgentOS — an AI agent managing network infrastructure (MikroTik routers, hotspots, CCTV, IoT).
Use the provided function tools to answer requests. Prefer calling a tool over guessing.
Always confirm before rebooting hardware or deleting data.
If a voucher is requested, create it immediately without further confirmation.
When managing CCTV, target devices by their deviceId.`;
  }

  _getToolsDescription() {
    let desc = '';
    this.toolRegistry.forEach((tool, name) => {
      desc += `- ${name}: ${tool.description || ''}\n`;
    });
    if (this.skillRegistry) {
      for (const manifest of this.skillRegistry.list()) {
        const impl = this.skillRegistry.implementations?.get(manifest.name);
        if (impl && typeof impl.getTools === 'function') {
          for (const [n, t] of Object.entries(impl.getTools())) {
            desc += `- ${n}: ${t.description || ''}\n`;
          }
        }
      }
    }
    return desc;
  }

  async processQuery(text, context = {}) {
    try {
      const intent = await this.qnap.classifyIntent(text);
      if (intent.confidence > 0.9 && intent.action !== 'unknown') {
        return await this.executeDirectCommand(intent, context);
      }

      const chat = this.model.startChat({
        history: this.getConversationHistory(context.userId),
        generationConfig: { temperature: 0.2, topP: 0.8, topK: 40 },
      });

      let result = await chat.sendMessage(text);
      let response = result.response;

      // ── Native Gemini function-calling loop ──────────────────────────────
      const MAX_TOOL_TURNS = 8;
      let toolTurns = 0;
      while (toolTurns < MAX_TOOL_TURNS) {
        const calls =
          (typeof response.functionCalls === 'function' ? response.functionCalls() : null) || [];
        if (!calls.length) break;
        toolTurns++;

        const toolResults = await Promise.all(
          calls.map(async call => {
            const toolName = call.name.replace(/__/g, '.');
            let toolResult;
            try {
              toolResult = await this.executeTool(toolName, call.args || {}, context);
            } catch (err) {
              toolResult = { error: err.message };
            }
            return { functionResponse: { name: call.name, response: { result: toolResult } } };
          })
        );

        result = await chat.sendMessage(toolResults);
        response = result.response;
      }

      const responseText =
        typeof response.text === 'function' ? response.text() : response.text || '';
      if (!responseText) return { error: true, message: 'No response from AI' };

      // Legacy JSON tool-call fallback for models that don't use native fn-calling
      const toolCall = this.parseToolCall(responseText);
      if (toolCall) {
        const toolResult = await this.executeTool(toolCall.name, toolCall.params, context);
        return {
          response: this.formatToolResponse(toolCall.name, toolResult),
          data: toolResult,
          suggestions: this.getSuggestions(toolCall.name),
        };
      }

      this.updateConversationHistory(context.userId, text, responseText);
      return {
        response: responseText,
        suggestions: ['Show users', 'Create voucher', 'System stats'],
      };
    } catch (error) {
      logger.error('AICoordinator processQuery error:', error);
      return { error: true, message: 'AI processing failed. Try /users or /voucher 1day' };
    }
  }

  _registerStaticTools() {
    // Voucher tool remains static for now as it involves complex logic/QR generation
    this.toolRegistry.set('voucher.create', {
      description: 'Generate WiFi voucher (plans: 1hour, 1day, 1week)',
      execute: async params => {
        // Q-NAP Fraud Detection
        const fraudCheck = await this.qnap.analyzeTransaction({
          userId: params.chatId,
          amount: this._getPlanPrice(params.plan),
          timestamp: Date.now(),
          deviceFingerprint: params.fingerprint,
        });

        if (fraudCheck.riskScore > 0.8) {
          logger.audit('fraud_detected', { plan: params.plan, risk: fraudCheck.riskScore });
          throw new Error('Transaction flagged for review');
        }

        const db = await getDatabase();
        const code = voucherAgent.generate(params.plan || '1hour');

        const { default: dateUtils } = await import('../utils/date.js');

        const planObj = DEFAULT_PLANS[params.plan] || { name: 'Custom', deviceLimit: 1 };
        const expiresAt =
          planObj.durationValue && planObj.durationUnit
            ? dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString()
            : null;

        const loginUrl = `http://${this.mikrotik?.state?.host || DEFAULT_LOGIN_DOMAIN}/login?username=${code}&password=${code}`;

        const vData = {
          plan: params.plan,
          planName: planObj.name || params.plan,
          durationUnit: planObj.durationUnit || null,
          durationValue: planObj.durationValue || null,
          deviceLimit: planObj.deviceLimit || 1,
          expiresAt,
          loginUrl,
          createdBy: 'telegram_bot',
          fraudScore: fraudCheck.riskScore,
        };

        await db.createVoucher(code, vData);

        if (this.mikrotik && this.mikrotik.state?.isConnected) {
          const _durationToMikrotik = p => {
            if (!p || !p.durationValue || !p.durationUnit) return null;
            const v = p.durationValue;
            switch (p.durationUnit) {
              case 'weeks':
                return `${v}w`;
              case 'days':
                return `${v}d`;
              case 'hours':
                return `${String(v).padStart(2, '0')}:00:00`;
              case 'minutes':
                return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
              default:
                return null;
            }
          };
          await this.mikrotik
            .addHotspotUser({
              username: code,
              password: code,
              profile: params.plan,
              sharedUsers: vData.deviceLimit,
              ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) }),
            })
            .catch(() => {});
        }

        // Generate QR code
        const qrData = await QRCode.toDataURL(`WIFI:T:WPA;S:AgentOS;P:${code};;`);

        return {
          success: true,
          code,
          plan: params.plan,
          expiresAt: this._getExpiryDate(params.plan),
          qrCode: qrData.split(',')[1], // Remove data:image prefix
          fraudCheck: fraudCheck.riskScore < 0.3 ? 'passed' : 'review',
        };
      }, // close execute fn
    }); // close {description, execute} object + toolRegistry.set call
  } // close _registerStaticTools

  async processCommand(command, params) {
    const tool = this.toolRegistry.get(command);
    if (tool?.execute) {
      return await tool.execute(params);
    }
    // Fallback to NLU parsing
    return await this.processQuery(command, params);
  }

  parseToolCall(response) {
    // Look for JSON tool calls in response
    const jsonMatch = response.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  async executeTool(name, params, context = {}) {
    const sandbox = getUserSandbox({ db: this.db });
    const userId = context.userId || 'system';

    // ── RBAC + sandbox gate (nanoclaw PermissionPolicy pattern) ────────────
    // Build a lazy executor so sandbox can intercept without running the real call
    const realExecutor = async (args, ctx) => {
      // 1. Static toolRegistry
      const tool = this.toolRegistry.get(name);
      if (tool) return await tool.execute(args, ctx);

      // 2. toolToSkillMap (fully-qualified tool names like 'user.kick')
      const skillName = this.toolToSkillMap.get(name);
      if (skillName) {
        return await this.skillRegistry.execute(skillName, name, args, {
          ...ctx,
          logger,
          mikrotik: this.mikrotik,
        });
      }

      // 3. Direct skill name
      if (this.skillRegistry.skills.has(name)) {
        return await this.skillRegistry.execute(name, args, {
          ...ctx,
          logger,
          mikrotik: this.mikrotik,
        });
      }

      throw new Error(`Unknown tool: ${name}`);
    };

    return sandbox.execute(userId, name, params, realExecutor, {
      ...context,
      mikrotik: this.mikrotik,
      // channels can set a defaultRole in their config (e.g. telegram defaultRole:'operator')
      // so unprovisioned users get a sensible level instead of the most restrictive 'user' role
      fallbackRole: context.channelRole || context.defaultRole || 'user',
    });
  }

  getConversationHistory(userId) {
    if (!userId) return [];
    return this.conversationContext.get(userId) || [];
  }

  updateConversationHistory(userId, userText, modelText) {
    if (!userId) return;
    const history = this.conversationContext.get(userId) || [];
    history.push(
      { role: 'user', parts: [{ text: userText }] },
      { role: 'model', parts: [{ text: modelText }] }
    );
    // Keep last 20 turns (40 entries) to avoid context window overflow
    if (history.length > 40) history.splice(0, history.length - 40);
    this.conversationContext.set(userId, history);
  }

  _getPlanPrice(plan) {
    const prices = { '1hour': 0.5, '1day': 2, '1week': 10, '1month': 30 };
    return prices[plan] || 2;
  }

  _getExpiryDate(plan) {
    const now = new Date();
    const durations = { '1hour': 1, '1day': 24, '1week': 168 };
    now.setHours(now.getHours() + (durations[plan] || 24));
    return now.toISOString();
  }

  formatToolResponse(toolName, result) {
    const formatters = {
      'users.active': r => `Found ${r.length} active users`,
      'voucher.create': r => `Created voucher ${r.code} (${r.plan})`,
      'system.stats': r => `CPU: ${r['cpu-load']}%, Uptime: ${r.uptime}`,
    };

    return formatters[toolName] ? formatters[toolName](result) : JSON.stringify(result);
  }

  getSuggestions(lastAction) {
    const suggestions = {
      'users.active': ['Kick user', 'View stats', 'Create voucher'],
      'voucher.create': ['Create another', 'View active users', 'Check stats'],
      default: ['Show users', 'Create voucher', 'System stats'],
    };
    return suggestions[lastAction] || suggestions.default;
  }

  async executeDirectCommand(intent, context) {
    // Direct execution for known intents without Gemini
    const mappings = {
      list_users: { tool: 'users.active', response: 'Here are the active users:' },
      get_stats: { tool: 'system.stats', response: 'System status:' },
      kick_user: { tool: 'user.kick', params: { username: intent.target } },
    };

    const mapping = mappings[intent.action];
    if (!mapping)
      return { response: "I didn't understand. Try: list users, kick [name], create voucher" };

    const result = await this.executeTool(mapping.tool, mapping.params || {});
    return {
      response: `${mapping.response}\n${this.formatToolResponse(mapping.tool, result)}`,
      data: result,
    };
  }
  async processInteraction(msg, context = {}) {
    logger.debug(`Processing interaction from ${context.channel || 'unknown'}: ${msg.text}`);

    const result = await this.processQuery(msg.text, {
      userId: msg.userId,
      channel: context.channel,
      ...context,
    });

    return {
      success: !result.error,
      result: {
        text: result.response,
        data: result.data,
        suggestions: result.suggestions,
      },
      error: result.message,
    };
  }
}

export default AICoordinator;
