#!/usr/bin/env node

/**
 * Pre-uninstall script
 * Runs before npm uninstall -g agentos
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function removeFromPath() {
  const home = os.homedir();
  const configs = [
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.zshrc'),
    path.join(home, '.profile')
  ];
  
  configs.forEach(config => {
    if (fs.existsSync(config)) {
      let content = fs.readFileSync(config, 'utf8');
      
      // Remove AgentOS PATH section
      const regex = /\n# AgentOS PATH\nexport PATH="[^"]*:\$PATH"\n/g;
      content = content.replace(regex, '');
      
      fs.writeFileSync(config, content);
    }
  });
}

// Stop running gateway
const { STATE_PATH } = require('../src/core/config');
const pidFile = path.join(STATE_PATH, 'gateway.pid');

if (fs.existsSync(pidFile)) {
  try {
    const pid = fs.readFileSync(pidFile, 'utf8');
    process.kill(parseInt(pid), 'SIGTERM');
    console.log('Stopped running gateway');
  } catch (e) {
    // Ignore
  }
}

removeFromPath();
console.log('AgentOS uninstalled. PATH cleaned up.');
