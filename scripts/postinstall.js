#!/usr/bin/env node

/**
 * Post-install script for global setup
 * Runs automatically after npm install -g agentos
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const chalk = require('chalk');

function getShellConfigFile() {
  const shell = process.env.SHELL || '/bin/bash';
  const home = os.homedir();
  
  if (shell.includes('zsh')) {
    return path.join(home, '.zshrc');
  } else if (shell.includes('bash')) {
    // Check for .bash_profile first (macOS), then .bashrc
    const bashProfile = path.join(home, '.bash_profile');
    const bashrc = path.join(home, '.bashrc');
    
    if (fs.existsSync(bashProfile)) {
      return bashProfile;
    }
    return bashrc;
  } else if (shell.includes('fish')) {
    return path.join(home, '.config/fish/config.fish');
  }
  
  return path.join(home, '.profile');
}

function addToPath(npmGlobalPath) {
  const shellConfig = getShellConfigFile();
  const pathExport = `\n# AgentOS PATH\nexport PATH="${npmGlobalPath}:$PATH"\n`;
  
  // Check if already in PATH
  if (fs.existsSync(shellConfig)) {
    const content = fs.readFileSync(shellConfig, 'utf8');
    if (content.includes('AgentOS PATH')) {
      console.log(chalk.gray('PATH already configured in', shellConfig));
      return;
    }
  }
  
  // Add to shell config
  fs.appendFileSync(shellConfig, pathExport);
  console.log(chalk.green(`✓ Added to PATH in ${shellConfig}`));
  console.log(chalk.yellow('  Run this to apply changes:'));
  console.log(chalk.cyan(`  source ${shellConfig}`));
}

function detectNpmGlobalPath() {
  try {
    // Get npm global prefix
    const prefix = execSync('npm config get prefix', { encoding: 'utf8' }).trim();
    
    // npm bin location depends on OS
    if (process.platform === 'win32') {
      return path.join(prefix);
    } else {
      return path.join(prefix, 'bin');
    }
  } catch (error) {
    return null;
  }
}

function main() {
  console.log(chalk.cyan('\n🚀 AgentOS Global Installation\n'));
  
  // Only run for global installs
  const isGlobalInstall = !process.env.INIT_CWD || 
                          process.cwd().includes('node_modules');
  
  if (!isGlobalInstall) {
    console.log(chalk.gray('Skipping PATH setup for local install'));
    return;
  }
  
  const npmGlobalPath = detectNpmGlobalPath();
  
  if (!npmGlobalPath) {
    console.log(chalk.yellow('⚠ Could not detect npm global path'));
    return;
  }
  
  console.log(chalk.gray(`NPM global bin: ${npmGlobalPath}`));
  
  // Check if already in PATH
  const currentPath = process.env.PATH || '';
  if (currentPath.includes(npmGlobalPath)) {
    console.log(chalk.green('✓ AgentOS is already in your PATH'));
  } else {
    addToPath(npmGlobalPath);
  }
  
  console.log(chalk.cyan('\n📖 Quick Start:'));
  console.log('  agentos onboard    Setup your configuration');
  console.log('  agentos --help     Show all commands');
  console.log('  agentos doctor     Verify installation\n');
}

main();
