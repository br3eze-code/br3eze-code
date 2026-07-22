#!/usr/bin/env node
/**
 * Cordova before_build hook — ensures release-signing.properties exists
 * in platforms/android/ before Gradle runs.
 * Cordova's prepare step can wipe this file, so we recreate it here.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const androidDir = path.join(context.opts.projectRoot, 'platforms', 'android');
    const signingPropsPath = path.join(androidDir, 'release-signing.properties');
    const keystorePath = path.join(context.opts.projectRoot, 'br3eze-release-key.keystore');

    // Only write if the file doesn't already exist
    if (!fs.existsSync(signingPropsPath)) {
        const content = [
            `storeFile=${keystorePath.replace(/\\/g, '\\\\')}`,
            'storePassword=br3eze123',
            'keyAlias=br3eze-alias',
            'keyPassword=br3eze123',
            ''
        ].join('\n');

        fs.mkdirSync(androidDir, { recursive: true });
        fs.writeFileSync(signingPropsPath, content, 'utf8');
        console.log('✅ [signing-hook] Created release-signing.properties at:', signingPropsPath);
    } else {
        console.log('✅ [signing-hook] release-signing.properties already exists.');
    }
};
