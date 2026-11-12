#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const exists = (p) => fs.existsSync(path.join(root, p));
const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }
  catch (error) { failures.push(p + ': invalid JSON or unreadable file (' + error.message + ')'); return null; }
};
const pkg = readJson('package.json');
const vercel = readJson('vercel.json');
const script = exists('scripts/vercel-build.mjs') ? fs.readFileSync(path.join(root, 'scripts/vercel-build.mjs'), 'utf8') : '';
const cordova = exists('config.xml') ? fs.readFileSync(path.join(root, 'config.xml'), 'utf8') : '';

if (!pkg?.scripts?.['vercel:build']) failures.push('package.json: vercel:build script is required');
if (!pkg?.scripts?.['build:web'] || !pkg.scripts['vercel:build'].includes('build:web')) failures.push('package.json: vercel:build must delegate to the existing build:web script');
if (!vercel?.buildCommand?.includes('vercel:build')) failures.push('vercel.json: buildCommand must invoke the existing vercel:build script');
if (!vercel?.outputDirectory) failures.push('vercel.json: outputDirectory is required');
const outputMatch = script.match(/const output = path\.join\(root, ['"]([^'"]+)['"]\)/);
if (!outputMatch) failures.push('scripts/vercel-build.mjs: output directory declaration was not found');
else if (vercel?.outputDirectory !== outputMatch[1]) failures.push('vercel.json outputDirectory "' + vercel?.outputDirectory + '" does not match build output "' + outputMatch[1] + '"');
if (!script.includes("path.join(source, 'home.html')") || !exists('www/home.html')) failures.push('Vercel build: required www/home.html source is missing');
if (!exists('www/index.html')) failures.push('Vercel build: required www/index.html source is missing');
for (const apiPath of ['api/index.js', 'api/[...path].js']) {
  if (!exists(apiPath)) failures.push('Vercel deployment: required API route ' + apiPath + ' is missing');
}
for (const route of Object.keys(vercel?.functions || {})) {
  if (!exists(route)) failures.push('vercel.json: configured function "' + route + '" does not exist');
}
if (vercel?.installCommand && !vercel.installCommand.includes('npm ci')) failures.push('vercel.json: installCommand must use the committed npm lockfile through npm ci');
if (vercel?.installCommand?.includes('--legacy-peer-deps')) warnings.push('vercel.json uses --legacy-peer-deps; resolve underlying peer-version conflicts before removing this compatibility flag.');
if (!pkg?.scripts?.['build:android'] || !pkg?.scripts?.['build:android:release']) failures.push('package.json: existing Android build and release scripts are required');
const appId = cordova.match(/<widget[^>]*\bid="([^"]+)"/)?.[1];
const version = cordova.match(/<widget[^>]*\bversion="([^"]+)"/)?.[1];
const versionCode = cordova.match(/android:versionCode="(\d+)"/)?.[1];
if (!appId) failures.push('config.xml: widget app id is required');
if (!version) failures.push('config.xml: widget version is required');
if (!versionCode) failures.push('config.xml: numeric android:versionCode is required');
if (!cordova.includes('scripts/cordova-hooks/ensure-signing.js')) warnings.push('config.xml does not reference the repository signing readiness hook.');

for (const warning of warnings) console.warn('WARN: ' + warning);
if (failures.length) {
  console.error('Release configuration validation failed (' + failures.length + ' issue(s)):');
  for (const failure of failures) console.error('- ' + failure);
  process.exitCode = 1;
} else {
  console.log('Release configuration validation passed (Vercel output: ' + vercel.outputDirectory + '; Android app: ' + appId + '; version: ' + version + '; versionCode: ' + versionCode + ').');
}
