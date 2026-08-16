import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EncryptionVault } from '../../core/vault.js';
import { isBack, isCancel } from '../../core/interaction/navigation.js';
import { authorizationCodeLogin, githubDeviceFlowLogin, DEFAULT_GITHUB_SCOPE, USER_API_URL } from '../../core/oauth2.js';

const execFileAsync = promisify(execFile);

// ==========================================
// AGENTOS LOGIN / LOGOUT / WHOAMI
// GitHub OAuth Device Flow — no redirect URI, no local web server.
// Credentials are encrypted at rest with the same AES-256-GCM scheme
// vault.js uses, stored in PROFILE_DIR/credentials.json. This is the
// CLI operator's own identity — separate from the gateway's
// Firestore-backed OAuthVault, which holds per-end-user tokens for
// hotspot customers and needs a live DB connection. Login should work
// even before the gateway/DB is set up.
// ==========================================


function credentialsPath() {
    const { PROFILE_DIR } = global.AGENTOS;
    return path.join(PROFILE_DIR, 'credentials.json');
}

function getVault() {
    return new EncryptionVault(process.env.VAULT_MASTER_KEY);
}

function readCredentials() {
    const file = credentialsPath();
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const vault = getVault();
        return {
            provider: raw.provider,
            login: raw.login,
            name: raw.name,
            avatar: raw.avatar,
            accessToken: vault.decrypt(raw.encryptedToken),
            scope: raw.scope,
            loggedInAt: raw.loggedInAt
        };
    } catch (err) {
        return null; // corrupted/foreign-key file — treat as logged out
    }
}

function writeCredentials({ provider, login, name, avatar, accessToken, scope }) {
    const vault = getVault();
    const record = {
        provider,
        login,
        name,
        avatar,
        encryptedToken: vault.encrypt(accessToken),
        scope,
        loggedInAt: new Date().toISOString()
    };
    fs.writeFileSync(credentialsPath(), JSON.stringify(record, null, 2), { mode: 0o600 });
}

async function deviceFlowLogin({ clientId, scope, log, note }) {
    return githubDeviceFlowLogin({
        clientId,
        scope,
        onPrompt: ({ verificationUri, userCode }) => {
            note(`Open ${verificationUri} in a browser and enter this code:\n\n  ${userCode}\n`, 'GitHub Login');
        },
        onStatus: (message) => log.info(message),
        userAgent: 'AgentOS-CLI'
    });
}

function decodeFirebaseToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = parts[1];
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decodedJson = Buffer.from(base64, 'base64').toString('utf8');
        return JSON.parse(decodedJson);
    } catch (e) {
        return null;
    }
}

async function openBrowser(url) {
    if (process.platform === 'win32') {
        await execFileAsync('cmd', ['/c', 'start', '', url]);
    } else if (process.platform === 'darwin') {
        await execFileAsync('open', [url]);
    } else {
        await execFileAsync('xdg-open', [url]);
    }
}

async function authorizationCodeProviderLogin(provider, { log, note }) {
    const section = provider === 'google' ? global.AGENTOS.config.OAUTH.GOOGLE : global.AGENTOS.config.OAUTH.FACEBOOK;
    if (!section.CLIENT_ID) throw new Error(`No ${provider} OAuth client ID configured.`);
    if (provider === 'facebook' && !section.REDIRECT_URI) {
        throw new Error('FACEBOOK_OAUTH_REDIRECT_URI must be an exact loopback URI registered in the Meta App Dashboard.');
    }
    const result = await authorizationCodeLogin({
        provider,
        clientId: section.CLIENT_ID,
        clientSecret: section.CLIENT_SECRET,
        redirectUri: section.REDIRECT_URI,
        scope: section.SCOPE,
        openBrowser,
        onPrompt: ({ authorizationUrl }) => note(`Your browser will open for ${provider} authorization.\nIf it does not, open this URL:\n${authorizationUrl}`, `${provider} Login`),
        onStatus: message => log.info(message),
        userAgent: 'AgentOS-CLI'
    });
    return result;
}

async function openaiApiKeyLogin({ log, note, text }) {
    const apiKey = (await text({
        message: 'Paste your OpenAI API key:',
        placeholder: 'sk-…',
        validate: value => value.trim().startsWith('sk-') ? undefined : 'Enter an OpenAI API key beginning with sk-'
    })).trim();
    if (!apiKey) throw new Error('Login cancelled or empty API key.');

    const response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'AgentOS-CLI' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI API key validation failed.');

    note(
        'OpenAI API access is authenticated with an API key. AgentOS does not use or imitate the private ChatGPT web OAuth flow.',
        'OpenAI authentication'
    );
    return {
        provider: 'openai-api',
        login: 'openai-api-user',
        name: 'OpenAI API account',
        avatar: '',
        accessToken: apiKey,
        scope: 'openai:api'
    };
}

async function firebaseLogin({ log, note }) {
    const { text } = await import('@clack/prompts');
    const loginUrl = 'https://br3eze.africa/login';
    note(
        `1. Open ${loginUrl} in a browser.\n` +
        `2. Log in with your operator/administrator credentials.\n` +
        `3. Under your Profile/CLI settings, copy your CLI Access Token.\n`,
        'Firebase OAuth via br3eze.africa'
    );

    const token = await text({
        message: 'Paste your CLI Access Token:',
        placeholder: 'eyJhbGciOiJSUzI1NiIs...',
        validate: v => v.trim().length > 0 ? undefined : 'Token cannot be empty'
    });

    const rawToken = typeof token === 'string' ? token.trim() : '';
    if (!rawToken) {
        throw new Error('Login cancelled or empty token.');
    }

    const decoded = decodeFirebaseToken(rawToken);
    if (!decoded) {
        throw new Error('Invalid token format (expected JWT)');
    }

    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        throw new Error('Token has already expired');
    }

    return {
        provider: 'firebase',
        login: decoded.email || decoded.user_id || decoded.sub || 'firebase-user',
        name: decoded.name || decoded.email || 'Firebase User',
        avatar: decoded.picture || '',
        accessToken: rawToken,
        scope: 'firebase:user'
    };
}

export default (program) => {
    program
        .command('login')
        .description('Log in to AgentOS via GitHub, Google, Facebook, OpenAI API key, or Firebase')
        .option('--provider <provider>', 'Login provider: github, google, facebook, openai, or firebase')
        .option('--client-id <id>', 'GitHub OAuth App client ID (overrides GITHUB_CLIENT_ID)')
        .action(async (options) => {
            const { intro, outro, note, log, select, text } = await import('@clack/prompts');
            intro('🔐 AgentOS Login');

            const existing = readCredentials();
            if (existing) {
                log.warn(`Already logged in as ${existing.login} (${existing.provider}). Run 'agentos logout' first to switch accounts.`);
                outro('No changes made');
                return;
            }

            let provider = options.provider;
            if (!provider) {
                const choice = await select({
                    message: 'Select login provider:',
                    options: [
                        { value: 'github', label: 'GitHub (OAuth device flow)' },
                        { value: 'google', label: 'Google (OAuth browser flow)' },
                        { value: 'facebook', label: 'Facebook (OAuth browser flow)' },
                        { value: 'openai', label: 'OpenAI API key (usage-based API access)' },
                        { value: 'firebase', label: 'Firebase (OAuth via br3eze.africa/login)' },
                        { value: '__back', label: '← Back' },
                        { value: '__cancel', label: 'Cancel' }
                    ]
                });
                if (typeof choice !== 'string' || isCancel(choice) || choice === '__cancel') {
                    outro('Login cancelled');
                    return;
                }
                if (isBack(choice) || choice === '__back') {
                    outro('No provider selected');
                    return;
                }
                provider = choice;
            }

            if (provider === 'github') {
                const clientId = options.clientId || process.env.GITHUB_CLIENT_ID;
                if (!clientId) {
                    log.error('No GitHub OAuth client ID configured.');
                    note(
                        'Set GITHUB_CLIENT_ID in your environment (or .env), or pass --client-id.\n' +
                        'Create a GitHub OAuth App at https://github.com/settings/developers\n' +
                        'and enable "Device Flow" in its settings.',
                        'Setup required'
                    );
                    outro('Login cancelled');
                    process.exitCode = 1;
                    return;
                }
                try {
                    const { accessToken, scope } = await deviceFlowLogin({
                        clientId,
                        scope: process.env.GITHUB_OAUTH_SCOPE || DEFAULT_GITHUB_SCOPE,
                        log,
                        note
                    });

                    const userRes = await fetch(USER_API_URL, {
                        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'AgentOS-CLI' }
                    });
                    const user = await userRes.json();
                    if (!userRes.ok) throw new Error(user.message || 'Failed to fetch GitHub profile');

                    writeCredentials({
                        provider: 'github',
                        login: user.login,
                        name: user.name || user.login,
                        avatar: user.avatar_url,
                        accessToken,
                        scope
                    });

                    log.success(`Logged in as ${user.login}${user.name ? ` (${user.name})` : ''}`);
                    outro('✓ Login complete');
                } catch (err) {
                    log.error(`Login failed: ${err.message}`);
                    outro('Login failed');
                    process.exitCode = 1;
                }
            } else if (provider === 'google' || provider === 'facebook') {
                try {
                    const creds = await authorizationCodeProviderLogin(provider, { log, note });
                    writeCredentials(creds);
                    log.success(`Logged in as ${creds.login}`);
                    outro('✓ Login complete');
                } catch (err) {
                    log.error(`Login failed: ${err.message}`);
                    outro('Login failed');
                    process.exitCode = 1;
                }
            } else if (provider === 'openai') {
                try {
                    const creds = await openaiApiKeyLogin({ log, note, text });
                    writeCredentials(creds);
                    log.success('OpenAI API key validated and stored securely.');
                    outro('✓ Login complete');
                } catch (err) {
                    log.error(`Login failed: ${err.message}`);
                    outro('Login failed');
                    process.exitCode = 1;
                }
            } else if (provider === 'firebase') {
                try {
                    const creds = await firebaseLogin({ log, note });
                    writeCredentials(creds);
                    log.success(`Logged in as ${creds.login}`);
                    outro('✓ Login complete');
                } catch (err) {
                    log.error(`Login failed: ${err.message}`);
                    outro('Login failed');
                    process.exitCode = 1;
                }
            } else {
                log.error(`Unknown provider: ${provider}`);
                outro('Login cancelled');
                process.exitCode = 1;
            }
        });

    program
        .command('logout')
        .description('Log out of AgentOS, removing stored credentials')
        .action(async () => {
            const { intro, outro, log } = await import('@clack/prompts');
            intro('🔓 AgentOS Logout');

            const file = credentialsPath();
            if (!fs.existsSync(file)) {
                log.warn('Not currently logged in.');
                outro('No changes made');
                return;
            }

            const creds = readCredentials();
            fs.unlinkSync(file);
            log.success(creds ? `Logged out of ${creds.login}` : 'Logged out');
            outro('✓ Done');
        });

    program
        .command('whoami')
        .description('Show the currently logged-in AgentOS account')
        .option('--json', 'Print as JSON')
        .action(async (options) => {
            const creds = readCredentials();

            if (options.json) {
                console.log(JSON.stringify(creds ? {
                    provider: creds.provider,
                    login: creds.login,
                    name: creds.name,
                    scope: creds.scope,
                    loggedInAt: creds.loggedInAt
                } : null, null, 2));
                return;
            }

            const { intro, outro, note } = await import('@clack/prompts');
            intro('👤 AgentOS Identity');
            if (!creds) {
                note('Not logged in. Run `agentos login` to authenticate.', 'whoami');
            } else {
                note(
                    `Provider:  ${creds.provider}\n` +
                    `Login:     ${creds.login}\n` +
                    `Name:      ${creds.name || '—'}\n` +
                    `Scope:     ${creds.scope || '—'}\n` +
                    `Logged in: ${creds.loggedInAt}`,
                    'whoami'
                );
            }
            outro('');
        });
};

export const _internal = { readCredentials, writeCredentials, credentialsPath, deviceFlowLogin, decodeFirebaseToken, firebaseLogin };;
