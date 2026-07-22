const fs = require('fs');
const path = require('path');

module.exports = function(context) {
    console.log('------------------------------------------------------------');
    console.log('⚡ STARTING CORDOVA ASSETS SECURITY & MINIFICATION HOOK ⚡');
    console.log('------------------------------------------------------------');

    // Dynamic requires (installed as devDependencies)
    let JavaScriptObfuscator, CleanCSS, htmlMinifier;
    try {
        JavaScriptObfuscator = require('javascript-obfuscator');
        CleanCSS = require('clean-css');
        htmlMinifier = require('html-minifier');
    } catch (err) {
        console.error('❌ Failed to require minification / obfuscation libraries. Make sure to install dependencies:');
        console.error('   npm install --save-dev javascript-obfuscator clean-css html-minifier');
        console.error(err);
        return;
    }

    const projectRoot = context.opts.projectRoot;
    const platforms = context.opts.platforms || [];

    platforms.forEach(platform => {
        let wwwPath;
        if (platform === 'android') {
            wwwPath = path.join(projectRoot, 'platforms/android/app/src/main/assets/www');
        } else if (platform === 'ios') {
            wwwPath = path.join(projectRoot, 'platforms/ios/www');
        } else if (platform === 'browser') {
            wwwPath = path.join(projectRoot, 'platforms/browser/www');
        } else {
            console.log(`ℹ️ [minify-and-obfuscate] Platform "${platform}" not configured/supported for minification, skipping.`);
            return;
        }

        if (!fs.existsSync(wwwPath)) {
            console.log(`⚠️ [minify-and-obfuscate] Directory not found for platform ${platform}: ${wwwPath}`);
            return;
        }

        console.log(`🔑 [minify-and-obfuscate] Processing assets for ${platform} in: ${wwwPath}`);
        
        let stats = { js: 0, css: 0, html: 0, errors: 0 };
        processDirectory(wwwPath, wwwPath, stats);
        
        console.log(`✅ [minify-and-obfuscate] Completed ${platform}: Obfuscated ${stats.js} JS, Minified ${stats.css} CSS, Minified ${stats.html} HTML. Errors: ${stats.errors}`);
    });

    // Run AndroidManifest cleaning if android platform is prepared
    if (platforms.includes('android')) {
        cleanAndroidManifest();
    }

    console.log('------------------------------------------------------------');
    console.log('⚡ CORDOVA ASSETS SECURITY & MINIFICATION HOOK COMPLETE ⚡');
    console.log('------------------------------------------------------------');

    function processDirectory(dir, baseWww, stats) {
        const files = fs.readdirSync(dir);

        files.forEach(file => {
            const filePath = path.join(dir, file);
            const relativePath = path.relative(baseWww, filePath);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                processDirectory(filePath, baseWww, stats);
            } else {
                const ext = path.extname(file).toLowerCase();

                // Skip pre-minified files
                if (file.endsWith('.min.js') || file.endsWith('.min.css')) {
                    return;
                }

                try {
                    const originalContent = fs.readFileSync(filePath, 'utf8');

                    if (ext === '.js') {
                        // Obfuscate and minify JS
                        const obfuscationResult = JavaScriptObfuscator.obfuscate(originalContent, {
                            compact: true,
                            controlFlowFlattening: false,
                            deadCodeInjection: false,
                            debugProtection: false,
                            disableConsoleLog: false,
                            identifierNamesGenerator: 'hexadecimal',
                            log: false,
                            numbersToExpressions: false,
                            renameGlobals: false,
                            selfDefending: false,
                            simplify: true,
                            splitStrings: false,
                            stringArray: true,
                            stringArrayCallsTransform: false,
                            stringArrayEncoding: [],
                            stringArrayIndexShift: true,
                            stringArrayRotate: true,
                            stringArrayShuffle: true,
                            stringArrayWrappersCount: 1,
                            stringArrayWrappersChainedCalls: true,
                            stringArrayWrappersParametersMaxCount: 2,
                            stringArrayWrappersType: 'variable',
                            stringArrayThreshold: 0.75,
                            unicodeEscapeSequence: false
                        });
                        fs.writeFileSync(filePath, obfuscationResult.getObfuscatedCode(), 'utf8');
                        stats.js++;
                    } else if (ext === '.css') {
                        // Minify CSS
                        const cleanCSSResult = new CleanCSS({}).minify(originalContent);
                        if (cleanCSSResult.errors && cleanCSSResult.errors.length > 0) {
                            throw new Error(cleanCSSResult.errors.join(', '));
                        }
                        fs.writeFileSync(filePath, cleanCSSResult.styles, 'utf8');
                        stats.css++;
                    } else if (ext === '.html') {
                        // Minify HTML
                        const minifiedHtml = htmlMinifier.minify(originalContent, {
                            collapseWhitespace: true,
                            removeComments: true,
                            minifyJS: true,
                            minifyCSS: true
                        });
                        fs.writeFileSync(filePath, minifiedHtml, 'utf8');
                        stats.html++;
                    }
                } catch (err) {
                    console.error(`❌ [minify-and-obfuscate] Error processing file ${relativePath}:`, err.message);
                    stats.errors++;
                }
            }
        });
    }

    // Clean Manifest function to deduplicate and fix manifest entries
    function cleanAndroidManifest() {
        const manifestPath = path.join(projectRoot, 'platforms/android/app/src/main/AndroidManifest.xml');
        if (!fs.existsSync(manifestPath)) {
            return;
        }

        console.log('🧹 [minify-and-obfuscate] Cleaning AndroidManifest.xml for duplicates...');
        try {
            let content = fs.readFileSync(manifestPath, 'utf8');

            // Find all uses-permission tags
            const permissionRegex = /<uses-permission[^>]+android:name="([^"]+)"[^>]*\/>/g;
            let permissions = [];
            let match;
            while ((match = permissionRegex.exec(content)) !== null) {
                const fullTag = match[0];
                const name = match[1];
                permissions.push({ tag: fullTag, name: name });
            }

            // Find all uses-feature tags
            const featureRegex = /<uses-feature[^>]+android:name="([^"]+)"[^>]*\/>/g;
            let features = [];
            while ((match = featureRegex.exec(content)) !== null) {
                const fullTag = match[0];
                const name = match[1];
                features.push({ tag: fullTag, name: name });
            }

            // Deduplicate permissions
            const uniquePermissions = {};
            permissions.forEach(p => {
                const name = p.name;
                const tag = p.tag;

                // Rules for deciding which permission tag to keep
                if (!uniquePermissions[name]) {
                    uniquePermissions[name] = tag;
                } else {
                    const currentTag = uniquePermissions[name];
                    // Prefer tags with tools:node="replace"
                    if (tag.includes('tools:node="replace"') && !currentTag.includes('tools:node="replace"')) {
                        uniquePermissions[name] = tag;
                    } 
                    // Prefer tags with maxSdkVersion
                    else if (tag.includes('android:maxSdkVersion') && !currentTag.includes('android:maxSdkVersion')) {
                        uniquePermissions[name] = tag;
                    }
                    // Else, if current tag has replace or maxSdkVersion, keep current; otherwise just keep either
                }
            });

            // Deduplicate features
            const uniqueFeatures = {};
            features.forEach(f => {
                const name = f.name;
                const tag = f.tag;

                if (!uniqueFeatures[name]) {
                    uniqueFeatures[name] = tag;
                } else {
                    const currentTag = uniqueFeatures[name];
                    // For GPS feature, prefer the one with required="false" and replace
                    if (name === 'android.hardware.location.gps') {
                        if (tag.includes('android:required="false"') || tag.includes('tools:node="replace"')) {
                            uniqueFeatures[name] = tag;
                        }
                    } else if (tag.includes('tools:node="replace"') && !currentTag.includes('tools:node="replace"')) {
                        uniqueFeatures[name] = tag;
                    }
                }
            });

            // Remove all original uses-permission tags from XML
            let cleanContent = content;
            permissions.forEach(p => {
                cleanContent = cleanContent.replace(p.tag, '');
            });

            // Remove all original uses-feature tags from XML
            features.forEach(f => {
                cleanContent = cleanContent.replace(f.tag, '');
            });

            // Re-insert clean permissions and features right before </manifest> tag
            const cleanPermissionsStr = Object.values(uniquePermissions).map(t => '    ' + t.trim()).join('\n');
            const cleanFeaturesStr = Object.values(uniqueFeatures).map(t => '    ' + t.trim()).join('\n');

            const insertStr = '\n' + cleanPermissionsStr + '\n' + cleanFeaturesStr + '\n';
            cleanContent = cleanContent.replace('</manifest>', insertStr + '</manifest>');

            // Clean up any double blank lines
            cleanContent = cleanContent.replace(/\n\s*\n\s*\n/g, '\n\n');

            fs.writeFileSync(manifestPath, cleanContent, 'utf8');
            console.log('✅ [minify-and-obfuscate] Cleaned AndroidManifest.xml successfully.');
        } catch (err) {
            console.error('❌ [minify-and-obfuscate] Failed to clean AndroidManifest.xml:', err.message);
        }
    }
};
