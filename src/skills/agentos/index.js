import { BaseDriver } from '../base.js';
import { logger } from '../../core/logger.js';
import * as printerService from '../../core/printer.js';
import voucherManager from '../../services/vouchers.js';

class AgentOSCoreDriver extends BaseDriver {
  static id = 'agentos';
  static name = 'AgentOS Core';
  static description = 'Core management tools for printers, messaging, and system-wide operations';
  constructor(config, logger) { super(config, logger); }
  static getTools() {
    return {
      'agentos.broadcast': { risk: 'medium', description: 'Send a message to all enabled communication channels', parameters: { type: 'object', properties: { message: { type: 'string' }, urgent: { type: 'boolean', default: false } }, required: ['message'] } },
      'agentos.printer.test': { risk: 'low', description: 'Send a test print page to the configured printer', parameters: { type: 'object', properties: { text: { type: 'string' } } } },
      'agentos.printer.list': { risk: 'low', description: 'List available printer interfaces', parameters: { type: 'object', properties: {} } },
      'agentos.voucher.create': { risk: 'medium', description: 'Generate voucher(s) and optionally print them', parameters: { type: 'object', properties: { profile: { type: 'string', default: '1Hour' }, quantity: { type: 'number', default: 1 }, print: { type: 'boolean', default: true }, interface: { type: 'string' } } } },
      'agentos.voucher.print': { risk: 'low', description: 'Print an existing voucher', parameters: { type: 'object', properties: { voucher: { type: 'object' }, interface: { type: 'string' } }, required: ['voucher'] } },
      'agentos.channels.status': { risk: 'low', description: 'Check active communication channels', parameters: { type: 'object', properties: {} } }
    };
  }
  async execute(action, args = {}, context = {}) {
    logger?.info?.(`[AgentOSCoreDriver] Executing ${action}`);
    const agent = context.agent || context.registry?.agent;
    switch (action) {
      case 'agentos.broadcast':
        if (!context.channels) return { success: false, error: 'ChannelManager not available in execution context' };
        try { await context.channels.broadcast(args.urgent ? `⚠️ URGENT: ${args.message}` : args.message); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
      case 'agentos.printer.test':
        try { return await printerService.printVoucher({ username: 'TEST-USER', password: 'TEST-PASSWORD', profile: 'DIAGNOSTIC', loginUrl: 'http://hotspot.local/login' }); } catch (err) { return { success: false, error: err.message }; }
      case 'agentos.printer.list':
        try { return { success: true, interfaces: await printerService.listAvailableInterfaces() }; } catch (err) { return { success: false, error: err.message }; }
      case 'agentos.voucher.create': {
        const quantity = Math.max(1, Math.min(Number(args.quantity) || 1, 100)); const results = [];
        for (let i = 0; i < quantity; i++) {
          try {
            const voucher = await voucherManager.createVoucher(args.profile);
            let printStatus = 'skipped';
            if (args.print !== false) { const printed = await printerService.printVoucher(voucher, args.interface || 'PRINTER_MAIN'); printStatus = printed.success ? 'printed' : `failed: ${printed.error}`; }
            results.push({ username: voucher.username, printStatus });
          } catch (err) { results.push({ error: err.message }); }
        }
        return { success: results.every((r) => !r.error), results };
      }
      case 'agentos.voucher.print': return printerService.printVoucher(args.voucher, args.interface || 'PRINTER_MAIN');
      case 'agentos.channels.status': if (!agent) throw new Error('AgentOS instance not found in context'); return agent.channels.getStatus();
      default: throw new Error(`Tool ${action} not implemented in AgentOS driver`);
    }
  }
}
export default AgentOSCoreDriver;
