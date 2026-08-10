import { BaseDriver } from '../base.js';
import { logger } from '../../core/logger.js';
import * as printerService from '../../core/printer.js';
import * as voucherManager from '../../core/voucher.js';


class AgentOSCoreDriver extends BaseDriver {
  static id = 'agentos';
  static name = 'AgentOS Core';
  static description = 'Core management tools for printers, messaging, and system-wide operations';

  constructor(config, logger) {
    super(config, logger);
  }

  static getTools() {
    return {
      'agentos.broadcast': {
        risk: 'medium',
        description: 'Send a message to all enabled communication channels (Telegram, Slack, Discord, WhatsApp)',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to broadcast' },
            urgent: { type: 'boolean', description: 'If true, prefixes with alert emoji', default: false }
          },
          required: ['message']
        }
      },
      'agentos.printer.test': {
        risk: 'low',
        description: 'Send a test print page to the configured thermal printer',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Optional custom text to print' }
          }
        }
      },
      'agentos.printer.list': {
        risk: 'low',
        description: 'List available hardware interfaces (COM ports, serial devices) for printing',
        parameters: { type: 'object', properties: {} }
      },
      'agentos.voucher.create': {
        risk: 'medium',
        description: 'Generate hotspot voucher(s) and automatically print them',
        parameters: {
          type: 'object',
          properties: {
            profile: { type: 'string', description: 'Hotspot profile (e.g. 1Hour, 1Day, 7Day, 30Day)', default: '1Hour' },
            quantity: { type: 'number', description: 'Number of vouchers to generate (default: 1)', default: 1 },
            print: { type: 'boolean', description: 'Whether to print to thermal printer', default: true },
            interface: { type: 'string', description: 'Specific COM port interface or null for auto' }
          }
        }
      },
      'agentos.voucher.print': {
        risk: 'low',
        description: 'Print an existing voucher object to the thermal printer',
        parameters: {
          type: 'object',
          properties: {
            voucher: {
              type: 'object',
              description: 'Voucher object with username, password, profile, loginUrl',
              required: ['username', 'password']
            },
            interface: { type: 'string', description: 'Specific COM port interface or null for auto' }
          },
          required: ['voucher']
        }
      },
      'agentos.channels.status': {
        risk: 'low',
        description: 'Check connectivity status of all configured messaging channels',
        parameters: { type: 'object', properties: {} }
      }
    };
  }

  async execute(action, args = {}, context = {}) {
    this.logger?.info?.(`[AgentOSCoreDriver] Executing ${action}`, { args });
    const agent = context.agent || context.registry?.agent;

    switch (action) {
      case 'agentos.broadcast': {
        const message = args.urgent ? `⚠️ URGENT: ${args.message}` : args.message;
        if (context.channels) {
          try {
            await context.channels.broadcast(message);
            return { success: true, message: 'Broadcast dispatched to all active channels' };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
        return { success: false, error: 'ChannelManager not available in execution context' };
      }

      case 'agentos.printer.test': {
        const testData = args.text || 'AgentOS Thermal Printer Test Page\n' + new Date().toLocaleString();
        try {
          await printerService.printVoucher({
            username: 'TEST-USER',
            password: 'TEST-PASSWORD',
            profile: 'DIAGNOSTIC',
            loginUrl: 'http://br3eze.africa/login'
          });
          return { success: true, message: 'Test page sent to printer' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'agentos.printer.list': {
        try {
          const interfaces = await printerService.listAvailableInterfaces();
          return { success: true, interfaces };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'agentos.voucher.create': {
        try {
          const quantity = args.quantity || 1;
          const vouchers = [];
          const resList = [];

          for (let i = 0; i < quantity; i++) {
            const voucher = await voucherManager.createVoucher(args.profile);
            vouchers.push(voucher);

            let printStatus = 'skipped';
            if (args.print !== false) {
              const printResult = await printerService.printVoucher({
                username: voucher.username,
                password: voucher.password,
                profile: voucher.profile,
                loginUrl: voucher.loginUrl
              }, args.interface || 'PRINTER_MAIN');
              printStatus = printResult.success ? 'printed' : `failed: ${printResult.error}`;
            }
            resList.push({ username: voucher.username, printStatus });
          }

          return {
            success: true,
            message: `Bulk creation finished: ${quantity} vouchers created.`,
            results: resList
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'agentos.voucher.print': {
        try {
          const result = await printerService.printVoucher(args.voucher, args.interface || 'PRINTER_MAIN');
          return result;
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'agentos.channels.status':
        if (!agent) throw new Error('AgentOS instance not found in context');
        return agent.channels.getStatus();

      default:
        throw new Error(`Tool ${action} not implemented in AgentOS core driver`);
    }
  }
}

export default AgentOSCoreDriver;
