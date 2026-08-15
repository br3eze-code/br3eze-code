const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_API_URL = 'https://api.github.com/user';

export const DEFAULT_GITHUB_SCOPE = 'read:user repo';

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
