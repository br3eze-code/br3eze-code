import http from 'node:http';
import crypto from 'node:crypto';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_API_URL = 'https://api.github.com/user';

export const DEFAULT_GITHUB_SCOPE = 'read:user repo';

export const OAUTH_PROVIDERS = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    pkce: true,
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    pkce: true,
    deviceFlow: true,
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v26.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v26.0/oauth/access_token',
    profileUrl: 'https://graph.facebook.com/me?fields=id,name,email,picture',
    scope: 'public_profile,email',
    pkce: false,
  },
};

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return base64Url(crypto.randomBytes(24));
}

async function listenForCallback(redirectUri) {
  const target = new URL(redirectUri);
  if (!['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) {
    throw new Error('Automatic desktop OAuth requires a loopback redirect URI.');
  }
  const server = http.createServer();
  const result = new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const callback = new URL(request.url, `http://${target.host}`);
      if (callback.pathname !== target.pathname) return;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<p>AgentOS login received. You can close this window.</p>');
      resolve(Object.fromEntries(callback.searchParams.entries()));
    });
    server.on('error', reject);
  });
  await new Promise((resolve, reject) => server.listen(Number(target.port) || 0, target.hostname, resolve).on('error', reject));
  const address = server.address();
  const actualRedirectUri = new URL(redirectUri);
  actualRedirectUri.port = String(address.port);
  return { server, result, redirectUri: actualRedirectUri.toString() };
}

export async function authorizationCodeLogin({
  provider,
  clientId,
  clientSecret = '',
  redirectUri = 'http://127.0.0.1:0/oauth/callback',
  scope,
  openBrowser = async () => {},
  onPrompt = () => {},
  onStatus = () => {},
  fetchImpl = fetch,
  userAgent = 'AgentOS',
}) {
  const definition = OAUTH_PROVIDERS[provider];
  if (!definition) throw new Error(`Unsupported OAuth provider: ${provider}`);
  if (!clientId) throw new Error(`${provider} OAuth client ID is not configured.`);
  if (provider === 'facebook' && !clientSecret) {
    throw new Error('Facebook OAuth requires a server-side client secret or a configured OAuth relay; never embed the app secret in Electron.');
  }

  const callback = await listenForCallback(redirectUri);
  const state = createState();
  const pkce = definition.pkce ? createPkce() : null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback.redirectUri,
    response_type: 'code',
    scope: scope || definition.scope,
    state,
  });
  if (pkce) {
    params.set('code_challenge', pkce.challenge);
    params.set('code_challenge_method', 'S256');
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }
  const authorizationUrl = `${definition.authorizeUrl}?${params}`;
  onPrompt({ provider, authorizationUrl, redirectUri: callback.redirectUri });
  await openBrowser(authorizationUrl);
  onStatus(`Waiting for ${provider} authorization…`);

  try {
    const response = await callback.result;
    if (response.state !== state) throw new Error('OAuth state validation failed.');
    if (response.error) throw new Error(response.error_description || response.error);
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback.redirectUri,
      code: response.code,
    });
    if (clientSecret) tokenParams.set('client_secret', clientSecret);
    if (pkce) {
      tokenParams.set('code_verifier', pkce.verifier);
      tokenParams.set('grant_type', 'authorization_code');
    }
    const tokenResponse = await fetchImpl(`${definition.tokenUrl}${provider === 'facebook' ? `?${tokenParams}` : ''}`, {
      method: provider === 'facebook' ? 'GET' : 'POST',
      headers: provider === 'facebook' ? { 'User-Agent': userAgent } : { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: provider === 'facebook' ? undefined : tokenParams.toString(),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || tokenData.error) throw new Error(tokenData.error_description || tokenData.error?.message || tokenData.error || `${provider} token exchange failed.`);
    const accessToken = tokenData.access_token;
    const profileResponse = await fetchImpl(definition.profileUrl + (provider === 'facebook' ? `&access_token=${encodeURIComponent(accessToken)}` : ''), {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': userAgent },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || profile.error) throw new Error(profile.error?.message || profile.message || `Failed to fetch ${provider} profile.`);
    return {
      provider,
      login: profile.email || profile.login || profile.sub || profile.id,
      name: profile.name || profile.email || profile.login || `${provider} user`,
      avatar: profile.picture?.data?.url || profile.picture || '',
      accessToken,
      refreshToken: tokenData.refresh_token || null,
      scope: tokenData.scope || scope || definition.scope,
      expiresIn: tokenData.expires_in || null,
    };
  } finally {
    callback.server.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function githubDeviceFlowLogin({
  clientId,
  scope = DEFAULT_GITHUB_SCOPE,
  onPrompt = () => {},
  onStatus = () => {},
  openBrowser = async () => {},
  fetchImpl = fetch,
  userAgent = 'AgentOS',
}) {
  if (!clientId) throw new Error('A GitHub OAuth client ID is required.');

  const codeResponse = await fetchImpl(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  const codeData = await codeResponse.json();
  if (!codeResponse.ok || codeData.error) {
    throw new Error(codeData.error_description || codeData.error || 'Failed to start GitHub device authorization.');
  }

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval = 5,
  } = codeData;

  const prompt = { userCode, verificationUri, verificationUriComplete, expiresIn };
  onPrompt(prompt);
  if (verificationUriComplete) await openBrowser(verificationUriComplete);
  onStatus('Waiting for GitHub authorization…');

  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;
  while (Date.now() < deadline) {
    await wait(pollInterval);
    const tokenResponse = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      const userResponse = await fetchImpl(USER_API_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': userAgent },
      });
      const user = await userResponse.json();
      if (!userResponse.ok) throw new Error(user.message || 'Failed to fetch GitHub profile.');
      return {
        provider: 'github',
        login: user.login,
        name: user.name || user.login,
        avatar: user.avatar_url || '',
        accessToken: tokenData.access_token,
        scope: tokenData.scope || scope,
        expiresIn: tokenData.expires_in || null,
      };
    }
    if (tokenData.error === 'authorization_pending') continue;
    if (tokenData.error === 'slow_down') { pollInterval += 5000; continue; }
    if (tokenData.error === 'expired_token') throw new Error('Login code expired. Start login again.');
    if (tokenData.error === 'access_denied') throw new Error('GitHub authorization was denied.');
    throw new Error(tokenData.error_description || tokenData.error || 'GitHub device authorization failed.');
  }
  throw new Error('GitHub login timed out.');
}

export { DEVICE_CODE_URL, TOKEN_URL, USER_API_URL };

export default { githubDeviceFlowLogin, DEFAULT_GITHUB_SCOPE };

// The helper is intentionally provider-specific at the transport layer, but
// platform-neutral at the UX layer: terminal prints the prompt, while Electron
// opens verificationUriComplete and displays the same status in its renderer.
