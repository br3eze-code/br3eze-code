/**
 * AgentOS Hermes — tools.js
 * Tool registry: maps tool-id → API call + label + formatter
 * Used by both the Tools tab and the Agent ReAct loop
 */
'use strict';

const Tools = (() => {

  // ── Registry ───────────────────────────────────────────────────
  // Each entry: { label, group, fn: async(params)=>result, format: (result)=>string }
  const _reg = {

    // ── Router / System ───────────────────────────────────────────
    'router.status': {
      label: 'Router Status', group: 'ROUTER',
      fn: () => Client.v1.health(),
      format: r => _fmt(r.data || r),
    },
    'system.stats': {
      label: 'System Resources', group: 'ROUTER',
      fn: () => Client.v1.systemResources(),
      format: r => {
        const d = r.data?.[0] || r.data || {};
        return [
          `CPU LOAD    : ${d['cpu-load'] || '—'}%`,
          `FREE MEMORY : ${_bytes(d['free-memory'])}`,
          `TOTAL MEMORY: ${_bytes(d['total-memory'])}`,
          `UPTIME      : ${d.uptime || '—'}`,
          `VERSION     : ${d.version || '—'}`,
          `BOARD NAME  : ${d['board-name'] || '—'}`,
        ].join('\n');
      },
    },
    'system.identity': {
      label: 'Router Identity', group: 'ROUTER',
      fn: () => Client.v1.systemIdentity(),
      format: r => _fmt(r.data),
    },
    'router.users': {
      label: 'All Hotspot Users', group: 'ROUTER',
      fn: () => Client.v1.allUsers(),
      format: r => {
        const users = r.data || [];
        if (!users.length) return 'No users found.';
        return users.map(u => `${u.name || u.username || u['.id']}  profile=${u.profile || '—'}  disabled=${u.disabled || 'false'}`).join('\n');
      },
    },
    'router.active': {
      label: 'Active Sessions', group: 'ROUTER',
      fn: () => Client.v1.activeUsers(),
      format: r => {
        const users = r.data || [];
        if (!users.length) return 'No active sessions.';
        return users.map(u =>
          `${(u.user||u.username||'?').padEnd(18)} IP=${u.address||'—'}  uptime=${u.uptime||'—'}  bytes-in=${u['bytes-in']||'—'}`
        ).join('\n');
      },
    },
    'router.backup': {
      label: 'Backup Config', group: 'ROUTER',
      fn: () => Client.v1.execute('router.backup', {}),
      format: r => _fmt(r.data || r),
    },
    'router.reboot': {
      label: 'Reboot Router', group: 'ROUTER',
      dangerous: true,
      fn: () => Client.v1.reboot(),
      format: r => r.data?.message || 'Reboot scheduled.',
    },

    // ── Network ───────────────────────────────────────────────────
    'network.interfaces': {
      label: 'Network Interfaces', group: 'NETWORK',
      fn: () => Client.v2.nodes().catch(() => Client.v1.execute('interfaces.list', {})),
      format: r => _fmt(r.data || r),
    },
    'network.scan': {
      label: 'Network Scan', group: 'NETWORK',
      fn: () => Client.v1.execute('network.scan', {}),
      format: r => _fmt(r.data || r),
    },
    'network.dhcp': {
      label: 'DHCP Leases', group: 'NETWORK',
      fn: () => Client.v1.execute('dhcp.leases', {}),
      format: r => _fmt(r.data || r),
    },
    'network.ping': {
      label: 'Ping Host', group: 'NETWORK',
      fn: (p) => Client.v1.ping(p.host, p.count || 4),
      format: r => _fmt(r.data || r),
    },

    // ── Vouchers ──────────────────────────────────────────────────
    'voucher.stats': {
      label: 'Voucher Stats', group: 'VOUCHERS',
      fn: () => Client.v1.voucherStats(),
      format: r => {
        const d = r.data || {};
        return [
          `TOTAL   : ${d.total   ?? '—'}`,
          `ACTIVE  : ${d.active  ?? '—'}`,
          `USED    : ${d.used    ?? '—'}`,
          `EXPIRED : ${d.expired ?? '—'}`,
        ].join('\n');
      },
    },
    'voucher.plans': {
      label: 'Available Plans', group: 'VOUCHERS',
      fn: () => Client.v1.plans(),
      format: r => {
        const d = r.data || {};
        return Object.entries(d).map(([k, v]) =>
          `${k.padEnd(10)} ${v.name || k}  price=$${v.price ?? '—'}  dur=${v.durationValue||'—'}${v.durationUnit||''}`
        ).join('\n');
      },
    },
    'voucher.list': {
      label: 'Voucher List', group: 'VOUCHERS',
      fn: () => Client.v1.vouchers({ limit: 20 }),
      format: r => {
        const vs = r.data || [];
        if (!vs.length) return 'No vouchers found.';
        return vs.map(v =>
          `${(v.code||'?').padEnd(20)} ${(v.plan||'—').padEnd(10)} ${v.status||'active'}`
        ).join('\n');
      },
    },

    // ── Financial ─────────────────────────────────────────────────
    'financial.summary': {
      label: 'Financial Summary', group: 'FINANCIAL',
      fn: () => Client.v2.financialSummary(),
      format: r => {
        const d = r.data || {};
        return [
          `TODAY   : $${d.today ?? d.todayRevenue ?? '—'}`,
          `TOTAL   : $${d.total ?? d.totalRevenue ?? '—'}`,
          `PENDING : $${d.pending ?? '—'}`,
          `VOUCHERS: ${d.totalVouchers ?? '—'} total  ${d.activeVouchers ?? '—'} active`,
        ].join('\n');
      },
    },

    // ── System ────────────────────────────────────────────────────
    'system.health': {
      label: 'Full Health Check', group: 'SYSTEM',
      fn: () => Client.v3.diagnosticsFull(),
      format: r => {
        const d = r.data || {};
        const svcs = d.services || {};
        let out = `UPTIME  : ${Math.round((d.uptime||0)/60)}min\n`;
        out += `MEMORY  : ${d.memory?.heap || '—'} heap / ${d.memory?.rss || '—'} rss\n`;
        out += `ENV     : ${d.env || '—'}\n\nSERVICES:\n`;
        Object.entries(svcs).forEach(([k, v]) => {
          const up = v.status === 'up';
          out += `  ${(k+'          ').slice(0,14)} ${up ? '✓ UP' : '✗ DOWN'}\n`;
        });
        return out;
      },
    },
    'audit.list': {
      label: 'Audit Log', group: 'SYSTEM',
      fn: () => Client.v3.diagnosticsFull(),
      format: r => _fmt(r.data?.services || r.data || r),
    },
    'system.providers': {
      label: 'AI Providers', group: 'SYSTEM',
      fn: () => Client.v2.providers(),
      format: r => _fmt(r.data || r),
    },
    'system.channels': {
      label: 'Channels', group: 'SYSTEM',
      fn: () => Client.v2.channels(),
      format: r => _fmt(r.data || r),
    },
  };

  // ── Public ─────────────────────────────────────────────────────
  async function run(toolId, params) {
    const t = _reg[toolId];
    if (!t) throw new Error(`Unknown tool: ${toolId}`);
    const raw = await t.fn(params || {});
    return { raw, text: t.format ? t.format(raw) : _fmt(raw) };
  }

  function get(toolId) { return _reg[toolId] || null; }

  function list() { return Object.entries(_reg).map(([id, t]) => ({ id, label: t.label, group: t.group, dangerous: !!t.dangerous })); }

  // ── Agent-facing tool spec (for ReAct system prompt) ──────────
  function getAgentSpec() {
    return list().map(t => `  - ${t.id}${t.dangerous ? ' [DANGEROUS]' : ''}: ${t.label}`).join('\n');
  }

  // ── Helpers ────────────────────────────────────────────────────
  function _fmt(obj) {
    if (obj == null) return '(no data)';
    if (typeof obj === 'string') return obj;
    return JSON.stringify(obj, null, 2);
  }

  function _bytes(v) {
    if (!v) return '—';
    const n = parseInt(v);
    if (n > 1073741824) return (n / 1073741824).toFixed(1) + 'GB';
    if (n > 1048576)    return (n / 1048576).toFixed(1)    + 'MB';
    if (n > 1024)       return (n / 1024).toFixed(1)       + 'KB';
    return n + 'B';
  }

  return { run, get, list, getAgentSpec };
})();
