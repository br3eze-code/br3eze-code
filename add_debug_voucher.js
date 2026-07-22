const { getDatabase } = require('./src/core/database');

async function main() {
    try {
        const db = await getDatabase();
        await db.createVoucher('STAR-XXXX-XXXX', {
            value: 5
        });
        console.log('Successfully added debug voucher STAR-XXXX-XXXX');
        process.exit(0);
    } catch (e) {
        console.error('Error adding debug voucher:', e);
        process.exit(1);
    }
}

main();
