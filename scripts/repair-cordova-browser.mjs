#!/usr/bin/env node
/**
 * Repairs the cordova-browser 7.x npm template path mismatch.
 *
 * The published template/cordova/Api.js may resolve ./lib/check_reqs while
 * the package stores that module under bin/lib. The generated platform copy
 * is correct; this repair keeps the source template consistent for clean
 * `cordova platform add/build browser` installs.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.INIT_CWD || process.cwd();
const apiPath = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'template', 'cordova', 'Api.js');
const templateCheckReqs = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'lib', 'check_reqs.js');
const templateCordovaDir = path.dirname(apiPath);
const platformWwwDir = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'template', 'platform_www');

if (!fs.existsSync(apiPath) || !fs.existsSync(templateCheckReqs)) process.exit(0);

const original = fs.readFileSync(apiPath, 'utf8');
const repaired = original.replaceAll("require('./lib/check_reqs')", "require('../../lib/check_reqs')");
if (repaired !== original) {
  fs.writeFileSync(apiPath, repaired);
  console.log('[AgentOS] Repaired cordova-browser template check_reqs path.');
}

const packagePath = path.join(templateCordovaDir, 'package.json');
if (!fs.existsSync(packagePath)) {
  fs.writeFileSync(packagePath, JSON.stringify({ type: 'commonjs' }, null, 2) + '\\n');
  console.log('[AgentOS] Added CommonJS boundary for cordova-browser platform API.');
}
fs.mkdirSync(platformWwwDir, { recursive: true });
const markerPath = path.join(platformWwwDir, '.gitkeep');
if (!fs.existsSync(markerPath)) fs.writeFileSync(markerPath, '');
