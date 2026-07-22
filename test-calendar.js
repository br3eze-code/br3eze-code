const calendar = require('./skills/calendar/index.js');

async function test() {
  try {
    console.log("Creating event...");
    const evt = await calendar.execute({ action: 'create', event: { title: 'Test', start: '2026-05-08', end: '2026-05-09' } });
    console.log("Created:", evt);

    console.log("Listing events...");
    const events = await calendar.execute({ action: 'list' });
    console.log("Listed:", events);
    
    console.log("Updating event...");
    const updated = await calendar.execute({ action: 'update', event: { id: evt.id, title: 'Updated Test' } });
    console.log("Updated:", updated);
    
    console.log("Deleting event...");
    await calendar.execute({ action: 'delete', event: { id: evt.id } });
    console.log("Deleted.");
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
