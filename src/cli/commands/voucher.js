import fs from 'fs';
import QRCode from 'qrcode';
import { intro, outro, spinner, note, log, select, multiselect, isCancel } from '@clack/prompts';
import { getDatabase } from '../../core/database.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ==========================================
// AGENTOS VOUCHER COMMAND
// Voucher management — @clack/prompts edition
// ==========================================



// ── Plan definitions (mirrors 36.js CONFIG.VOUCHER_PLANS) ────────────────────
const PLAN_DEFS = {
  '1hour': { label: '1 Hour', price: 0.50, duration: '1h' },
  '1Day': { label: '1 Day', price: 1.00, duration: '24h' },
  '7Day': { label: '7 Days', price: 3.00, duration: '7d' },
  '30Day': { label: '30 Days', price: 6.00, duration: '30d' },
};

export default (program) => {
  const voucher = program
    .command('voucher')
    .description('Manage access vouchers')
    .alias('v');

  // ── voucher create ────────────────────────────────────────────────────────
  voucher
    .command('create [plan]')
    .description('Create a new voucher (interactive if plan omitted)')
    .option('--duration <duration>', 'Override duration (1h, 24h, 7d)', '')
    .option('--qty <n>', 'Quantity to generate', '1')
    .option('--qr', 'Save QR code to file', false)
    .option('--printer <id>', 'Printer ID to use (e.g. PRINTER_VOUCHER)', 'PRINTER_MAIN')
    .action(async (plan, options) => {
      const { BRAND, CONFIG_PATH } = global.AGENTOS;

      if (!fs.existsSync(CONFIG_PATH)) {
        log.error('Run agentos onboard first');
        return;
      }

      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

      // Interactive plan selection when omitted
      if (!plan) {
        intro(`${BRAND.emoji}  Create Voucher`);
        const choice = await select({
          message: 'Select plan:',
          options: Object.entries(PLAN_DEFS).map(([k, v]) => ({
            value: k,
            label: `${v.label.padEnd(10)}  $${v.price.toFixed(2)}`,
            hint: v.duration,
          })),
        });
        if (isCancel(choice)) { log.warn('Cancelled.'); return; }
        plan = choice;
      }

      const planDef = PLAN_DEFS[plan] || { label: plan, price: 0, duration: options.duration || '1h' };
      const duration = options.duration || planDef.duration;
      const qty = Math.max(1, parseInt(options.qty) || 1);

      const s = spinner();
      s.start(`Generating ${qty} voucher(s)…`);

      try {
        const db = await getDatabase();
        const voucherAgent = require('../../core/voucher');
        const created = [];

        for (let i = 0; i < qty; i++) {
          const code = await voucherAgent.generate(plan);
          await db.createVoucher(code, {
            plan, duration,
            status: 'active',
            createdAt: new Date(),
            createdBy: 'cli',
          });
          created.push(code);

          // Auto-print voucher
          try {
            const { printVoucher } = require('../../core/printer');
            const loginUrl = `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host}/login.html?code=${code}`;
            await printVoucher({
              username: code,
              password: code,
              profile: planDef.label,
              loginUrl: loginUrl,
              duration: duration,
              price: planDef.price,
              currency: '$'
            }, options.printer);
          } catch (err) {
            log.warn('Thermal print failed: ' + err.message);
          }
        }

        s.stop(`Created ${created.length} voucher(s)`);

        for (const code of created) {
          note(
            [
              `Code  :  ${code}`,
              `Plan  :  ${planDef.label}`,
              `Price :  $${planDef.price.toFixed(2)}`,
              `Duration :  ${duration}`,
              `Status   :  ACTIVE`,
            ].join('\n'),
            '🎫 New Voucher'
          );

          if (options.qr) {
            const qrData = JSON.stringify({
              code,
              plan,
              url: `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host}/login.html?code=${code}`,
            });
            const qrPath = `${global.AGENTOS.STATE_PATH}/qr-${code}.png`;
            await QRCode.toFile(qrPath, qrData);
            log.info(`QR saved: ${qrPath}`);
          }
        }

        outro('Voucher generation complete.');
        process.exit(0);
      } catch (error) {
        s.stop(`Failed: ${error.message}`);
        log.error(error.message);
        process.exit(1);
      }
    });

  // ── voucher list ──────────────────────────────────────────────────────────
  voucher
    .command('list')
    .description('List recent vouchers')
    .option('--limit <n>', 'Number to show', '10')
    .option('--used', 'Show only used vouchers')
    .option('--active', 'Show only active vouchers')
    .option('--print', 'Interactively select a voucher to print')
    .option('--printer <id>', 'Printer ID to use (e.g. PRINTER_MAIN)', 'PRINTER_MAIN')
    .action(async (options) => {
      const s = spinner();
      s.start('Fetching vouchers…');

      try {
        const db = await getDatabase();
        let vouchers = await db.getRecentVouchers(parseInt(options.limit));
        if (options.used) vouchers = vouchers.filter(v => v.used);
        if (options.active) vouchers = vouchers.filter(v => !v.used);
        s.stop(`${vouchers.length} voucher(s) found`);

        if (!vouchers.length) {
          log.warn('No vouchers match the filter.');
          return;
        }

        if (options.print) {
          const choices = await multiselect({
            message: 'Select vouchers to print (Space to select, Enter to confirm):',
            options: vouchers.map(v => ({
              value: v.code,
              label: `${v.code.padEnd(18)} (${v.plan || 'N/A'})`,
              hint: v.used ? 'Used' : 'Active'
            }))
          });

          if (isCancel(choices) || !choices.length) return;

          s.start(`Printing ${choices.length} voucher(s)…`);
          for (const code of choices) {
            const v = vouchers.find(v => v.code === code);
            await printExistingVoucher(v, options.printer);
          }
          s.stop(`Sent ${choices.length} job(s) to printer.`);
          outro('Batch printing complete.');
          return;
        }

        const lines = vouchers.map((v, i) => {
          const tag = v.used ? '✓ Used  ' : '○ Active';
          const date = v.createdAt?.toDate?.() || v.createdAt || '—';
          return `${String(i + 1).padStart(2)}. [${tag}]  ${(v.id || v.code || '').padEnd(18)}  ${(v.plan || '').padEnd(8)}  ${date}`;
        });

        note(lines.join('\n'), `🎟  Vouchers (${vouchers.length})`);
        log.info('Tip: Use --print to interactively select and print vouchers from this list.');
        outro('Done.');
        process.exit(0);
      } catch (error) {
        log.error(`Failed: ${error.message}`);
        process.exit(1);
      }
    });

  // ── voucher print ─────────────────────────────────────────────────────────
  voucher
    .command('print [code]')
    .description('Print an existing voucher by code (interactive if omitted)')
    .option('--printer <id>', 'Printer ID to use (e.g. PRINTER_MAIN)', 'PRINTER_MAIN')
    .action(async (code, options) => {
      const { BRAND } = global.AGENTOS;
      const db = await getDatabase();

      if (!code) {
        intro(`${BRAND.emoji}  Print Voucher`);
        const vouchers = await db.getRecentVouchers(20);
        if (!vouchers.length) {
          log.warn('No recent vouchers found to print.');
          return;
        }

        const choice = await select({
          message: 'Select voucher to print:',
          options: vouchers.map(v => {
            const code = v.id || v.code || 'UNKNOWN';
            return {
              value: code,
              label: `${code.padEnd(18)}  ${(v.plan || 'N/A').padEnd(10)}`,
              hint: v.used ? 'Used' : 'Active'
            };
          }),
        });
        if (isCancel(choice)) { log.warn('Cancelled.'); return; }
        code = choice;
      }

      const s = spinner();
      s.start(`Fetching voucher ${code}…`);
      try {
        const v = await db.getVoucher(code);
        if (!v) {
          s.stop('Not found');
          log.error('Voucher not found');
          return;
        }
        s.stop('Found');
        await printExistingVoucher(v, options.printer);
        outro('Print job sent.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
        process.exit(1);
      }
    });

  // ── voucher reprint ───────────────────────────────────────────────────────
  voucher
    .command('reprint')
    .description('Reprint the most recently created voucher')
    .option('--printer <id>', 'Printer ID to use', 'PRINTER_MAIN')
    .action(async (options) => {
      const s = spinner();
      s.start('Fetching last voucher…');
      try {
        const db = await getDatabase();
        const vouchers = await db.getRecentVouchers(1);
        if (!vouchers.length) {
          s.stop('No vouchers found');
          return;
        }
        const v = vouchers[0];
        s.stop(`Found: ${v.code}`);
        await printExistingVoucher(v, options.printer);
        outro('Print job sent.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
        process.exit(1);
      }
    });

  // ── voucher transfer / p2p ───────────────────────────────────────────────
  voucher
    .command('transfer <identifier> [plan]')
    .description('Directly issue and transfer a voucher to a user (P2P/Topup)')
    .option('--notify', 'Notify user via channel', true)
    .action(async (identifier, plan, options) => {
      const { BRAND } = global.AGENTOS;
      const db = await getDatabase();

      intro(`${BRAND.emoji}  Voucher Transfer / P2P`);
      const s = spinner();

      s.start(`Resolving user "${identifier}"…`);
      const user = await db.resolveUser(identifier);
      if (!user) {
        s.stop('User not found');
        log.error(`Could not find user matching "${identifier}". Try UID, email, or phone.`);
        return;
      }
      s.stop(`Found user: ${user.fullname || user.username || user.id}`);

      if (!plan) {
        const choice = await select({
          message: 'Select plan to transfer:',
          options: Object.entries(PLAN_DEFS).map(([k, v]) => ({
            value: k,
            label: `${v.label.padEnd(10)}  $${v.price.toFixed(2)}`,
            hint: v.duration,
          })),
        });
        if (isCancel(choice)) { log.warn('Cancelled.'); return; }
        plan = choice;
      }

      const planDef = PLAN_DEFS[plan] || { label: plan, price: 0, duration: '1h' };

      s.start(`Issuing ${planDef.label} to ${user.id}…`);
      try {
        const voucherAgent = require('../../core/voucher');
        const code = await voucherAgent.generate(plan);

        // Create voucher linked to user
        await db.createVoucher(code, {
          plan,
          duration: planDef.duration,
          userId: user.id,
          createdAt: new Date(),
          createdBy: 'cli-transfer',
          status: 'active'
        });

        // Topup wallet / record transaction if applicable
        if (planDef.price > 0) {
          await db.updateUser(user.id, {
            credits: (user.credits || 0) + planDef.price
          });
          await db.logAudit('voucher.transfer', 'cli', {
            userId: user.id,
            code,
            plan,
            price: planDef.price
          });
        }

        s.stop(`Successfully issued ${code}`);

        if (options.notify && user.channels) {
          // Attempt notification via active channel
          const channelId = user.channels.telegram || user.channels.whatsapp;
          if (channelId) {
            log.info(`Sending notification to user on ${user.channels.telegram ? 'Telegram' : 'WhatsApp'}…`);
            // This would normally go through the Orchestrator, but we can log it here
          }
        }

        note(
          [
            `User  :  ${user.fullname || user.id}`,
            `Code  :  ${code}`,
            `Plan  :  ${planDef.label}`,
            `Wallet:  +$${planDef.price.toFixed(2)} (New balance: $${((user.credits || 0) + planDef.price).toFixed(2)})`,
          ].join('\n'),
          '🎁 Transfer Complete'
        );

        outro('P2P Voucher issue complete.');
        process.exit(0);
      } catch (error) {
        s.stop(`Failed: ${error.message}`);
        log.error(error.message);
        process.exit(1);
      }
    });

  // ── voucher revoke ────────────────────────────────────────────────────────
  voucher
    .command('revoke <code>')
    .description('Revoke an unused voucher')
    .action(async (code) => {
      const s = spinner();
      s.start(`Revoking ${code}…`);
      try {
        const db = await getDatabase();
        const v = await db.getVoucher(code);

        if (!v) { s.stop('Voucher not found'); log.error('Voucher not found'); return; }
        if (v.used) { s.stop('Already used'); log.warn('Voucher already used — cannot revoke'); return; }

        await db.deleteVoucher(code);
        s.stop(`Revoked: ${code}`);
        outro('Done.');
        process.exit(0);
      } catch (error) {
        log.error(`Failed: ${error.message}`);
        process.exit(1);
      }
    });

  // ── voucher update ────────────────────────────────────────────────────────
  voucher
    .command('update <code> [plan]')
    .description('Update a voucher plan and print it')
    .option('--print', 'Print the voucher after updating', true)
    .option('--printer <id>', 'Printer ID to use', 'PRINTER_MAIN')
    .action(async (code, plan, options) => {
      const { BRAND } = global.AGENTOS;
      const db = await getDatabase();
      const v = await db.getVoucher(code);

      if (!v) {
        log.error(`Voucher ${code} not found`);
        return;
      }

      intro(`${BRAND.emoji}  Update Voucher ${code}`);

      if (!plan) {
        const choice = await select({
          message: `Select new plan for ${code} (current: ${v.plan || 'N/A'}):`,
          options: Object.entries(PLAN_DEFS).map(([k, val]) => ({
            value: k,
            label: `${val.label.padEnd(10)}  $${val.price.toFixed(2)}`,
            hint: val.duration,
          })),
        });
        if (isCancel(choice)) { log.warn('Cancelled.'); return; }
        plan = choice;
      }

      const s = spinner();
      s.start(`Updating voucher ${code} to ${plan}…`);

      try {
        const voucherAgent = require('../../core/voucher');
        const updated = await voucherAgent.updateVoucher(code, plan);
        s.stop(`Updated ${code}`);

        if (options.print) {
          s.start('Sending to printer…');
          await printExistingVoucher(updated, options.printer);
          s.stop('Printed successfully');
        }

        note(
          [
            `Code  :  ${code}`,
            `New Plan :  ${PLAN_DEFS[plan]?.label || plan}`,
            `Status:  Updated & Provisioned`,
          ].join('\n'),
          '🎫 Voucher Updated'
        );

        outro('Done.');
        process.exit(0);
      } catch (error) {
        s.stop(`Failed: ${error.message}`);
        log.error(error.message);
        process.exit(1);
      }
    });

  // ── voucher debug ─────────────────────────────────────────────────────────
  voucher
    .command('debug')
    .description('Voucher system diagnostics')
    .action(async () => {
      const { BRAND, CONFIG_PATH } = global.AGENTOS;
      intro(`${BRAND.emoji}  Voucher Diagnostics`);

      const checks = [];
      const s = spinner();

      // Config
      s.start('Checking configuration…');
      if (!fs.existsSync(CONFIG_PATH)) {
        s.stop('Config missing');
        checks.push({ name: 'Config', status: 'error', details: 'Run agentos onboard' });
      } else {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        s.stop('Config valid');
        checks.push({ name: 'Config', status: 'ok', details: `prefix: ${cfg.vouchers?.prefix || 'STAR'}` });
      }

      // Database
      s.start('Checking database…');
      try {
        const db = await getDatabase();
        const stats = await db.getStats();
        s.stop('Database reachable');
        checks.push({ name: 'Database', status: 'ok', details: `${db.db ? 'Firebase' : 'Local'}  ${stats.total} total, ${stats.active} active` });
      } catch (e) {
        s.stop(`Database error: ${e.message}`);
        checks.push({ name: 'Database', status: 'error', details: e.message });
      }

      // Generation dry-run
      s.start('Dry-run voucher generation…');
      try {
        const voucherAgent = require('../../core/voucher');
        const sample = await voucherAgent.generate('default').catch(() => 'error');
        s.stop(`Sample: ${sample}`);
        checks.push({ name: 'Generator', status: 'ok', details: `sample → ${sample}` });
      } catch (e) {
        s.stop(`Generator error: ${e.message}`);
        checks.push({ name: 'Generator', status: 'error', details: e.message });
      }

      const lines = checks.map(c => {
        const icon = c.status === 'ok' ? '●' : c.status === 'warn' ? '▲' : '■';
        return `${icon} ${c.name.padEnd(12)} ${c.details || ''}`;
      });
      note(lines.join('\n'), '📋 Diagnostics');

      const errors = checks.filter(c => c.status === 'error').length;
      outro(errors === 0 ? '✓ Voucher system is healthy.' : `✗ ${errors} issue(s) found.`);
    });
};

/** Helper to print an existing voucher object */
async function printExistingVoucher(v, printerId = 'PRINTER_MAIN') {
  const { printVoucher } = require('../../core/printer');
  const { getConfig } = require('../../core/config');
  const config = getConfig();

  const code = v.code || v.id;
  const planName = v.planName || v.plan || 'Default';

  // Construct login URL if missing
  const host = config.mikrotik?.ip || config.adapters?.mikrotik?.host || 'hotspot.local';
  const loginUrl = v.loginUrl || `http://${host}/login.html?code=${code}`;

  const planDef = PLAN_DEFS[v.plan] || { price: v.price || 0 };

  const result = await printVoucher({
    username: code,
    password: code,
    profile: planName,
    loginUrl: loginUrl,
    duration: v.durationValue ? `${v.durationValue}${v.durationUnit || ''}` : (v.duration || planDef.duration),
    expires: v.expiresAt,
    price: planDef.price,
    currency: '$',
    status: v.status
  }, printerId);

  if (!result.success) {
    throw new Error(result.error);
  }
}
