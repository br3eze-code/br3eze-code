import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(root, 'custom-plugins', 'cordova-plugin-background-modern');

const required = [
  'plugin.xml',
  'package.json',
  'www/background.js',
  'src/android/BackgroundPlugin.java',
  'src/android/BackgroundService.java',
  'src/ios/BackgroundPlugin.m'
];

for (const relative of required) {
  const file = path.join(plugin, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing background plugin file: ${relative}`);
}

const files = required.map((relative) => fs.readFileSync(path.join(plugin, relative), 'utf8')).join('\n');
const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');

if (!config.includes('cordova-plugin-background-modern')) {
  throw new Error('cordova-plugin-background-modern is not registered in config.xml');
}

if (files.includes('de.appplant.cordova.plugin.background') || config.includes('de.appplant.cordova.plugin.background')) {
  throw new Error('Legacy de.appplant Cordova background service is still present');
}

for (const token of [
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_SPECIAL_USE',
  'android:foregroundServiceType="specialUse"',
  'PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
  'FOREGROUND_SERVICE_START_FAILED'
]) {
  if (!files.includes(token)) throw new Error(`Background plugin missing required token: ${token}`);
}

console.log('Background plugin verification passed.');
