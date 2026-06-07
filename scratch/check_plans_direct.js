
const { getDatabase } = require('../src/core/database');

async function check() {
    try {
        const db = await getDatabase();
        const plans = await db.getPlans(false);
        console.log('Current Plans:');
        plans.forEach(p => {
            console.log(`- ID: ${p.id}, Name: ${p.name}, Profile: ${p.mikrotikProfile || 'N/A'}`);
        });
        console.log(`\nHash for '1Day': ${db.hashPlanId('1Day')}`);
        console.log(`Hash for '1Hour': ${db.hashPlanId('1Hour')}`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
