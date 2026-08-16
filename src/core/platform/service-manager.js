const COMMANDS = {
  systemd: {
    detect: 'command -v systemctl >/dev/null 2>&1 && printf systemd',
    status: (unit) => `systemctl show ${quote(unit)} --no-page -p LoadState,ActiveState,SubState`,
    restart: (unit) => `systemctl restart ${quote(unit)}`,
    logs: (unit, since) => `journalctl -u ${quote(unit)} --since=${quote(since)} --no-pager -n 50`,
  },
  openrc: {
    detect: 'command -v rc-service >/dev/null 2>&1 && printf openrc',
    status: (unit) => `rc-service ${quote(unit)} status`,
    restart: (unit) => `rc-service ${quote(unit)} restart`,
    logs: (_unit, _since) => 'logread 2>/dev/null || tail -n 50 /var/log/messages',
  },
  sysvinit: {
    detect: 'command -v service >/dev/null 2>&1 && printf sysvinit',
    status: (unit) => `service ${quote(unit)} status`,
    restart: (unit) => `service ${quote(unit)} restart`,
    logs: (unit, _since) => `tail -n 50 ${quote(`/var/log/${unit}.log`)}`,
  },
  launchd: {
    detect: 'command -v launchctl >/dev/null 2>&1 && printf launchd',
    status: (unit) => `launchctl print system/${quote(unit)}`,
    restart: (unit) => `launchctl kickstart -k system/${quote(unit)}`,
    logs: (_unit, _since) => 'log show --last 1h --style compact',
  },
  windows: {
    detect: 'command -v sc.exe >/dev/null 2>&1 && printf windows',
    status: (unit) => `sc.exe query ${quote(unit)}`,
    restart: (unit) => `sc.exe stop ${quote(unit)} && sc.exe start ${quote(unit)}`,
    logs: (_unit, _since) => 'wevtutil qe System /c:50 /rd:true /f:text',
  },
};

function quote(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:@/-]+$/.test(text)) throw new Error('Invalid service name.');
  return `'${text}'`;
}

export function getServiceManager(name) {
  const manager = COMMANDS[name];
  if (!manager) throw new Error(`Unsupported service manager: ${name}`);
  return manager;
}

export function serviceManagerCandidates(platform = process.platform) {
  if (platform === 'win32') return ['windows'];
  if (platform === 'darwin') return ['launchd'];
  return ['systemd', 'openrc', 'sysvinit'];
}

export function buildServiceCommand(action, manager, unit, since = '1h') {
  const adapter = getServiceManager(manager);
  if (!adapter[action]) throw new Error(`Unsupported service action: ${action}`);
  return adapter[action](unit, since);
}

export function detectionCommand(platform = process.platform) {
  return serviceManagerCandidates(platform).map((name) => COMMANDS[name].detect).join(' || ');
}

export { quote };
