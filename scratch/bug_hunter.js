// scratch/bug_hunter.js
const { getConfig } = require('../src/core/config');
const { discoverBluetoothPrinterPort } = require('../src/core/printer');
const { logger } = require('../src/core/logger');
const fs = require('fs');
const path = require('path');

async function runAudit() {
    console.log('🔍 Starting AgentOS Bug Hunter Audit...\n');

    // 1. Audit Config
    console.log('--- Config Audit ---');
    try {
        const config = getConfig();
        console.log('✅ Config loaded successfully.');
        console.log(`   - Printer Enabled: ${config.printer?.enabled}`);
        console.log(`   - Printer Type: ${config.printer?.type}`);
        console.log(`   - Printer Interface: ${config.printer?.interface}`);
        
        if (config.slack) {
            console.log(`   - Slack Enabled: ${config.slack?.enabled}`);
        } else {
             console.log('⚠️  Warning: config.slack is undefined');
        }
        
        if (config.discord) {
            console.log(`   - Discord Enabled: ${config.discord?.enabled}`);
        } else {
             console.log('⚠️  Warning: config.discord is undefined');
        }
        
        if (config.slack?.enabled && !config.slack?.token) {
            console.log('⚠️  Warning: Slack is enabled but token is missing.');
        }
        if (config.discord?.enabled && !config.discord?.token) {
            console.log('⚠️  Warning: Discord is enabled but token is missing.');
        }
    } catch (e) {
        console.log(`❌ Config Audit Failed: ${e.message}`);
        console.log(e.stack);
    }

    // 2. Audit Printer Discovery
    console.log('\n--- Printer Discovery Audit ---');
    try {
        console.log('📡 Running Bluetooth Printer Discovery...');
        const port = discoverBluetoothPrinterPort();
        if (port) {
            console.log(`✅ Discovered Port: ${port}`);
        } else {
            console.log('ℹ️  No Bluetooth printers discovered via PnpDevice.');
        }
    } catch (e) {
        console.log(`❌ Printer Discovery Error: ${e.message}`);
    }

    // 3. Audit Environment Files
    console.log('\n--- Environment File Audit ---');
    const envPath = path.join(process.cwd(), '.env');
    const agentEnvPath = path.join(process.cwd(), '.env.agentos');
    
    if (fs.existsSync(envPath)) {
        console.log('✅ .env file exists.');
    } else {
        console.log('⚠️  .env file missing (critical for production).');
    }
    
    if (fs.existsSync(agentEnvPath)) {
        console.log('✅ .env.agentos exists (wizard output).');
    }

    // 4. Audit Core Modules
    console.log('\n--- Module Integrity Audit ---');
    const coreFiles = [
        'AgentOS.js', 'onboard.js', 'printer.js', 'config.js',
        'channels/ChannelManager.js', 'channels/SlackChannel.js', 'channels/DiscordChannel.js'
    ];
    
    for (const file of coreFiles) {
        const fullPath = path.join(process.cwd(), 'src', 'core', file);
        if (fs.existsSync(fullPath)) {
            try {
                // We don't use require() here because it might execute side effects 
                // and fail due to missing env vars in this context. 
                // Just check if it's syntactically valid by using a simple node -c check?
                // Or just assume existence is enough for now.
                console.log(`✅ ${file}: Found`);
            } catch (e) {
                console.log(`❌ ${file}: Failed to load! ${e.message}`);
            }
        } else {
            console.log(`❌ ${file}: MISSING!`);
        }
    }

    console.log('\nAudit Complete. 🚀');
}

runAudit().catch(console.error);
