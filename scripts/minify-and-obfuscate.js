#!/usr/bin/env node
/**
 * Cordova after_prepare hook (declared in config.xml).
 *
 * Obfuscates the PLATFORM COPY of www/*.js (e.g. platforms/android/app/src/
 * main/assets/www/js/) after `cordova prepare` stages it -- the source
 * www/ tree is left untouched so it stays readable for browser/PWA
 * development and debugging.
 *
 * Kept deliberately conservative: string-array obfuscation + hex identifier
 * renaming for local scopes only. `renameGlobals` stays false because many
 * files share state across separate <script> tags via bare globals
 * (DataStore, Auth, currentUser, db, HardwarePrinter, ...) -- renaming those
 * declarations would break every other file that references them by name.
 * Control-flow flattening / dead-code injection are off too: this app is
 * large (app.js alone is 5000+ lines) and those transforms meaningfully
 * bloat parse/execution time on a mobile WebView for limited extra benefit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_FILES = new Set(['cordova.js', 'cordova_plugins.js', 'html5-qrcode.min.js']);
const SKIP_DIRS = new Set(['plugins', 'res']);

function findPlatformWww(platformRoot) {
    const candidates = [
        path.join(platformRoot, 'app', 'src', 'main', 'assets', 'www'), // cordova-android 9+ (Gradle)
        path.join(platformRoot, 'assets', 'www'),                       // older cordova-android
        path.join(platformRoot, 'www'),                                 // ios / browser
        path.join(platformRoot, 'platform_www')
    ];
    return candidates.find(p => fs.existsSync(p));
}

function walkJsFiles(dir, onFile) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkJsFiles(full, onFile);
        else onFile(full);
    }
}

module.exports = function (context) {
    let JavaScriptObfuscator;
    try {
        JavaScriptObfuscator = require('javascript-obfuscator');
    } catch (e) {
        console.warn('[obfuscate] javascript-obfuscator is not installed (npm install) -- skipping obfuscation for this build.');
        return;
    }

    const platforms = (context.opts.platforms && context.opts.platforms.length)
        ? context.opts.platforms
        : ['android'];

    platforms.forEach((platform) => {
        const platformRoot = path.join(context.opts.projectRoot, 'platforms', platform);
        const wwwDir = findPlatformWww(platformRoot);
        if (!wwwDir) {
            console.warn(`[obfuscate] Could not find a www directory for platform "${platform}" (looked under ${platformRoot}) -- skipping.`);
            return;
        }

        let count = 0;
        walkJsFiles(path.join(wwwDir, 'js'), (file) => {
            if (!file.endsWith('.js') || file.endsWith('.min.js')) return;
            if (SKIP_FILES.has(path.basename(file))) return;

            const source = fs.readFileSync(file, 'utf8');
            try {
                const result = JavaScriptObfuscator.obfuscate(source, {
                    compact: true,
                    controlFlowFlattening: false,
                    deadCodeInjection: false,
                    stringArray: true,
                    stringArrayThreshold: 0.6,
                    identifierNamesGenerator: 'hexadecimal',
                    renameGlobals: false,
                    selfDefending: false
                });
                fs.writeFileSync(file, result.getObfuscatedCode(), 'utf8');
                count++;
            } catch (e) {
                console.warn(`[obfuscate] Failed to obfuscate ${file}, leaving it as-is:`, e.message);
            }
        });
        console.log(`[obfuscate] Obfuscated ${count} file(s) for platform "${platform}" at ${wwwDir}/js`);
    });
};
