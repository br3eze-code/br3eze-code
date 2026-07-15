// migration.js
/**
 * Migrate from MikroTik-only to Domain-Agnostic
 */

async function migrate() {
  console.log('🔄 Migrating to Domain-Agnostic AgentOS...');
  
  // 1. Load old config
  const { default: oldConfig } = await import('./old-config.json', { with: { type: 'json' } });
  
  // 2. Create new workspace
  const workspace = {
    name: 'Network Infrastructure',
    domain: 'network',
    adapters: [{
      type: 'mikrotik',
      name: 'Legacy Router',
      config: {
        host: oldConfig.mikrotik.host,
        user: oldConfig.mikrotik.user,
        password: oldConfig.mikrotik.pass
      }
    }],
    billing: {
      voucherTypes: [{
        resourceType: 'network',
        plans: Object.keys(oldConfig.plans || {}).map(key => ({
          id: key,
          price: oldConfig.plans[key].price,
          value: oldConfig.plans[key].duration
        }))
      }]
    }
  };
  
  // 3. Import existing vouchers
  const db = await import('./src/core/database.js');
  const oldVouchers = await db.getAllVouchers();
  
  for (const v of oldVouchers) {
    await newdb.saveVoucher({
      ...v,
      type: 'access',
      resourceType: 'network',
      metadata: { migrated: true }
    });
  }
  
  // 4. Save new config
  const fs = await import('fs');
  const yaml = await import('yaml');
  fs.writeFileSync('./agentos.yaml', 
    yaml.stringify(workspace)
  );
  
  console.log('✅ Migration complete!');
}
