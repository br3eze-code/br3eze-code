const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const { create_agent } = require('./create_agent');

const onboard = {
  name: "onboard",
  description: "Onboard fleet, generate Mission Control, and auto-create agents with skills/roles/duties/tools",
  parameters: { type: "object", properties: { target: { type: "string" }, admin_password: { type: "string" }, hotspot_name: { type: "string", default: "AgentOS-Hotspot" }, dns_servers: { type: "string", default: "1.1.1.1,8.8.8.8" }, gateway_url: { type: "string" } }, required: ["target"] },
  run: async ({ target, admin_password, hotspot_name = "AgentOS-Hotspot", dns_servers = "1.1.1.1,8.8.8.8", gateway_url = "http://localhost:3000" }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = [inventory.find(r => r.id === target)].filter(Boolean);
    if (targets.length === 0) throw new Error('No routers matched');

    const results = [];
    for (const router of targets) {
      const cfg = { host: router.host, user: router.user, password: admin_password || router.password, wan_interface: router.wan_interface || 'ether1', lan_ip: router.lan_ip || '10.5.50.1/24' };
      const api = new RouterOSAPI({ host: cfg.host, user: cfg.user, password: cfg.password, timeout: 15 });
      try {
        await api.connect();
        await api.write('/system/identity/set', [`=name=AgentOS-${router.id}`]);
        await api.write('/system/backup/save', ['=name=agentos-post-onboard']);
        await api.close();

        // === CREATE DEDICATED AGENT ===
        await create_agent.run({
          name: `router-${router.id}`,
          purpose: `Autonomous operator for ${router.name} at ${router.host}`,
          persona: "Precise MikroTik engineer, cautious with changes",
          triggers: "manual,schedule,alert",
          allowed_skills: "router_health,create_user,hotspot_brand,rollback,memory",
          roles: "network-operator,security-auditor,config-manager",
          duties: "monitor health,provision users,backup configs,manage hotspot,respond to alerts",
          tools: "routeros-api,ssh,winbox,ping,snmp,gateway-api",
          memory_namespace: router.id,
          auto_run: false
        }, { logger });

        results.push({ id: router.id, name: router.name, success: true, agent: `router-${router.id}` });
        await fs.appendFile('./knowledge/soul.md', `\n## Onboard ${router.id} ${new Date().toISOString()}\nAgent created: router-${router.id}\n`);
      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, name: router.name, success: false, error: err.message });
      }
    }

    // === CREATE FLEET MASTER AGENT ===
    if (results.filter(r=>r.success).length > 0) {
      await create_agent.run({
        name: "fleet-master",
        purpose: "Orchestrate entire AgentOS fleet",
        persona: "Fleet commander, strategic and systematic",
        triggers: "manual,schedule",
        allowed_skills: "router_health,onboard,create_user,create_agent,hotspot_brand,memory",
        roles: "orchestrator,admin,architect",
        duties: "fleet onboarding,agent spawning,health aggregation,policy enforcement,skill distribution",
        tools: "gateway-api,inventory-manager,agents-registry,mission-control",
        memory_namespace: "fleet",
        auto_run: false
      }, { logger });
    }

    const ok = results.filter(r => r.success).length;
    const token = process.env.AGENTOS_TOKEN || 'YOUR_TOKEN';
    const missionHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mission Control</title><script src="https://cdn.jsdelivr.net/npm/chart.js"></script><style>body{margin:0;background:#0f172a;color:#fff;font-family:system-ui}header{background:#1e293b;padding:16px}main{padding:20px;max-width:1200px;margin:auto}.card{background:#1e293b;padding:16px;border-radius:12px;margin:12px 0}</style></head><body><header><h1>🚀 AgentOS Mission Control</h1></header><main><div class="card"><h3>Fleet: ${ok} agents active</h3><p>Agents created: ${results.filter(r=>r.agent).map(r=>r.agent).join(', ')}</p><p>Fleet-master ready</p></div><canvas id="c" height="80"></canvas></main><script>new Chart(document.getElementById('c'),{type:'line',data:{labels:[],datasets:[{label:'Fleet CPU',data:[]}]}})</script></body></html>`;

    await fs.mkdir('/mnt/data', { recursive: true });
    await fs.writeFile('/mnt/data/AgentOS-Mission-Control.html', missionHtml);

    let msg = `🚀 *Onboard Complete* ${ok}/${targets.length}\n\n`;
    results.forEach(r => {
      msg += r.success? `✅ ${r.name} → agent *${r.agent}* created\n` : `❌ ${r.name}: ${r.error}\n`;
    });
    msg += `\n🤖 *Agents Gained:*\n• Skills: router_health, create_user, hotspot_brand, rollback, memory\n• Roles: network-operator, security-auditor, config-manager\n• Duties: monitor, provision, backup, manage hotspot, alert response\n• Tools: routeros-api, ssh, snmp, gateway-api\n\nFleet-master agent created for orchestration.`;

    return { success: ok > 0, message: msg, results };
  }
};

module.exports = { onboard };
