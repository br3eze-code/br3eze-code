const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const hotspot_brand = {
  name: "hotspot_brand",
  description: "Upload custom login.html, logo, CSS to hotspot. Shards to single router or fleet.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Router id, 'all', or 'role:branch'" },
      login_html: { type: "string", description: "Full HTML content for login.html" },
      logo_base64: { type: "string", description: "Optional: base64 PNG for logo.png" },
      css: { type: "string", description: "Optional: extra CSS" }
    },
    required: ["target", "login_html"]
  },

  run: async ({ target, login_html, logo_base64, css }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = [inventory.find(r => r.id === target)].filter(Boolean);
    if (targets.length === 0) throw new Error('No routers matched');

    const results = [];
    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 20 });
      try {
        await api.connect();
        try {
          await api.write('/file/set', ['=numbers=hotspot/login.html', '=name=hotspot/login.html.bak']);
        } catch {}
        await api.write('/file/add', ['=name=hotspot/login.html', `=contents=${login_html.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`]);
        if (logo_base64) await api.write('/file/add', ['=name=hotspot/logo.png', `=contents=${logo_base64}`]);
        if (css) await api.write('/file/add', ['=name=hotspot/style.css', `=contents=${css.replace(/\n/g, '\\n')}`]);
        await api.write('/ip/hotspot/profile/set', ['=numbers=0', '=html-directory=hotspot']);
        await api.close();
        results.push({ id: router.id, success: true });
        logger.info(`HOTSPOT_BRAND: ${router.id} updated`);
      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, success: false, error: err.message });
      }
      await new Promise(r => setTimeout(r, 500));
    }
    const ok = results.filter(r => r.success).length;
    let msg = `🎨 *Hotspot Brand Deploy*\n\n**Success**: ${ok}/${targets.length}\n\n`;
    results.forEach(r => { msg += r.success? `✅ ${r.id}\n` : `❌ ${r.id}: ${r.error}\n`; });
    await fs.appendFile('./knowledge/soul.md', `\n## Hotspot Brand ${new Date().toISOString()}\nTarget: ${target}\nSuccess: ${ok}/${targets.length}\n`);
    return { success: ok > 0, message: msg, results };
  }
};

module.exports = { hotspot_brand };
