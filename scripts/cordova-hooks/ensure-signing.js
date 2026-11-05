#!/usr/bin/env node
/**
 * Cordova before_compile hook (declared in config.xml).
 *
 * Only acts on RELEASE builds (package.json's build:android:release passes
 * --release and points Gradle at platforms/android/release-signing.properties
 * via -PcdvReleaseSigningPropertiesFile). Debug builds are unaffected.
 *
 * Generates release-signing.properties from environment variables rather
 * than committing signing secrets to the repo:
 *   BR3EZE_KEYSTORE_PASSWORD, BR3EZE_KEY_ALIAS, BR3EZE_KEY_PASSWORD
 */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const argv = (context.opts.options && context.opts.options.argv) || [];
    const isRelease = !!(context.opts.options && context.opts.options.release) || argv.includes('--release');
    if (!isRelease) return; // debug build, nothing to enforce

    const propsPath = path.join(context.opts.projectRoot, 'platforms', 'android', 'release-signing.properties');
    if (fs.existsSync(propsPath)) {
        console.log('[signing] release-signing.properties already present, using it as-is.');
        return;
    }

    const keystorePath = path.join(context.opts.projectRoot, 'br3eze-release-key.keystore');
    if (!fs.existsSync(keystorePath)) {
        console.error(`[signing] No keystore found at ${keystorePath} -- cannot prepare release signing.`);
        console.error('[signing] Build without --release for an unsigned debug APK, or add the keystore.');
        return;
    }

    const { BR3EZE_KEYSTORE_PASSWORD, BR3EZE_KEY_ALIAS, BR3EZE_KEY_PASSWORD } = process.env;
    if (!BR3EZE_KEYSTORE_PASSWORD || !BR3EZE_KEY_ALIAS || !BR3EZE_KEY_PASSWORD) {
        console.error('[signing] Missing BR3EZE_KEYSTORE_PASSWORD / BR3EZE_KEY_ALIAS / BR3EZE_KEY_PASSWORD env vars.');
        console.error('[signing] Set them and re-run the release build, or build without --release.');
        return;
    }

    const props = [
        `storeFile=${keystorePath.replace(/\\/g, '\\\\')}`,
        `storePassword=${BR3EZE_KEYSTORE_PASSWORD}`,
        `keyAlias=${BR3EZE_KEY_ALIAS}`,
        `keyPassword=${BR3EZE_KEY_PASSWORD}`
    ].join('\n') + '\n';

    fs.mkdirSync(path.dirname(propsPath), { recursive: true });
    fs.writeFileSync(propsPath, props, 'utf8');
    console.log('[signing] Generated release-signing.properties from environment variables.');
};
