// ==========================================
// AGENTOS DAHUA COMMAND
// Camera management — @clack/prompts edition
// ==========================================

'use strict';

const fs   = require('fs');
const { CONFIG_PATH } = require('../../core/config');

module.exports = (program) => {
  const dahua = program
    .command('dahua')
    .description('Manage Dahua cameras');

  // ── Resolve skill (lazy, throws on bad config — callers already catch) ────
  const getSkill = () => {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error('No configuration found — run: agentos onboard');
    }
    const DahuaSkill = require('../../skills/dahua/index.js');
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const workspace = config.adapters?.cctv || {};
    return new DahuaSkill(config, console, workspace);
  };

  // ── dahua list ────────────────────────────────────────────────────────────
  dahua
    .command('list')
    .description('List configured Dahua devices')
    .action(async () => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('📷 Dahua Devices');
      const s = spinner();
      s.start('Fetching device list…');
      try {
        const skill = getSkill();
        const res   = await skill.execute('dahua.device.list', {});
        const devices = Array.isArray(res) ? res : [res];
        s.stop(`${devices.length} device(s) found`);

        const lines = devices.map((d, i) =>
          `${String(i + 1).padStart(2)}. ${d.name || d.id || JSON.stringify(d)}`
        );
        note(lines.join('\n'), '📋 Device List');
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua snapshot ────────────────────────────────────────────────────────
  dahua
    .command('snapshot')
    .description('Get snapshot URL or path')
    .option('-d, --device <id>', 'Device ID')
    .option('-c, --channel <n>', 'Channel number')
    .option('-a, --all', 'Capture every channel on the device')
    .action(async (options) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('📸 Dahua Snapshot');
      const s = spinner();
      s.start(`Fetching snapshot${options.device ? ` for device ${options.device}` : ''}…`);
      try {
        const skill = getSkill();
        if (options.all) {
          const shots = await skill.execute('dahua.snapshot.getAll', { device: options.device });
          s.stop(`${shots.length} channel(s) captured`);
          const lines = shots.map(sh =>
            sh.error ? `Ch ${sh.channel} (${sh.name}): FAILED — ${sh.error}` : `Ch ${sh.channel} (${sh.name}): ${sh.size} bytes`
          );
          note(lines.join('\n'), '🖼️  Snapshots (all channels)');
        } else {
          const res = await skill.execute('dahua.snapshot.get', {
            device:  options.device,
            channel: options.channel,
          });
          s.stop('Snapshot retrieved');
          note(
            typeof res === 'string'
              ? `URL/Path :  ${res}`
              : JSON.stringify({ ...res, base64: res.base64 ? `<${res.size} bytes>` : undefined }, null, 2),
            '🖼️  Snapshot'
          );
        }
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua channels ────────────────────────────────────────────────────────
  dahua
    .command('channels')
    .description('List camera channels on a device/NVR')
    .option('-d, --device <id>', 'Device ID')
    .action(async (options) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('📡 Dahua Channels');
      const s = spinner();
      s.start('Reading channel list…');
      try {
        const skill = getSkill();
        const channels = await skill.execute('dahua.device.channels', { device: options.device });
        s.stop(`${channels.length} channel(s)`);
        note(channels.map(c => `${c.channel}. ${c.name}`).join('\n'), '📋 Channels');
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua stream ──────────────────────────────────────────────────────────
  dahua
    .command('stream')
    .description('Get live RTSP stream URL for a channel')
    .option('-d, --device <id>', 'Device ID')
    .option('-c, --channel <n>', 'Channel number', '1')
    .action(async (options) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('🎥 Dahua Live Stream');
      const s = spinner();
      s.start('Building stream URL…');
      try {
        const skill = getSkill();
        const res = await skill.execute('dahua.stream.url', {
          device:  options.device,
          channel: Number(options.channel),
        });
        s.stop('Stream URL ready');
        note(`Main : ${res.main}\nSub  : ${res.sub}\n\n${res.note}`, '🎥 RTSP Stream');
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua reboot ──────────────────────────────────────────────────────────
  dahua
    .command('reboot')
    .description('Reboot a Dahua device')
    .option('-d, --device <id>', 'Device ID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options) => {
      const { intro, outro, spinner, log, confirm, isCancel } = await import('@clack/prompts');
      intro('🔁 Dahua Reboot');
      if (!options.force) {
        const target = options.device || 'all devices';
        const ok = await confirm({ message: `Reboot ${target}?`, initialValue: false });
        if (isCancel(ok) || !ok) { log.warn('Cancelled.'); return; }
      }

      const s = spinner();
      s.start(`Sending reboot command${options.device ? ` to ${options.device}` : ''}…`);
      try {
        const skill = getSkill();
        await skill.execute('dahua.system.reboot', { device: options.device });
        s.stop('Reboot command sent');
        outro('✓ Device is rebooting.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });
};
