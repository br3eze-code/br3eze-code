import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubDeviceFlowLogin, DEFAULT_GITHUB_SCOPE } from '../src/core/oauth2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const localDataPath = path.join(app.getPath('localAppData'), 'AgentOS');
app.setPath('userData', localDataPath);
const configPath = path.join(localDataPath, 'config.json');
const credentialsPath = path.join(localDataPath, 'credentials.json');
const webRoot = app.isPackaged ? process.resourcesPath : projectRoot;
const bundledWebEntry = path.join(webRoot, 'www', 'index.html');

if (process.env.ELECTRON_DISABLE_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu');
}

let mainWindow;

function sanitizeDevice(device = {}) {
  return {
    name: device.name || device.label || device.deviceId || 'Unnamed device',
    deviceId: device.deviceId || device.id || null,
    host: device.host || device.ip || null,
    port: device.port || null,
    driver: device.driver || 'dahua',
    enabled: device.enabled !== false,
  };
}

async function readCctvConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    const cctv = config.adapters?.cctv || {};
    const groups = [
      ['dahua_devices', 'dahua'],
      ['hikvision_devices', 'hikvision'],
    ];
    const devices = groups.flatMap(([key, driver]) => Object.entries(cctv[key] || {}).map(([id, device]) => sanitizeDevice({ ...device, deviceId: device.deviceId || id, driver })));
    return { configPath, configured: true, devices };
  } catch (error) {
    if (error.code === 'ENOENT') return { configPath, configured: false, devices: [], message: 'No AgentOS configuration found.' };
    return { configPath, configured: false, devices: [], message: error.message };
  }
}

async function readDesktopIdentity() {
  try {
    const record = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
    return { provider: record.provider, login: record.login, name: record.name, scope: record.scope, loggedInAt: record.loggedInAt };
  } catch {
    return null;
  }
}

async function loginWithGithub() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error('GITHUB_CLIENT_ID is not configured for the desktop app.');
  const identity = await githubDeviceFlowLogin({
    clientId,
    scope: process.env.GITHUB_OAUTH_SCOPE || DEFAULT_GITHUB_SCOPE,
    openBrowser: (url) => shell.openExternal(url),
    onPrompt: (prompt) => mainWindow?.webContents.send('auth:github-prompt', prompt),
    onStatus: (status) => mainWindow?.webContents.send('auth:github-status', status),
    userAgent: 'AgentOS-Desktop',
  });
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
  await fs.mkdir(localDataPath, { recursive: true });
  const record = {
    provider: identity.provider,
    login: identity.login,
    name: identity.name,
    avatar: identity.avatar,
    encryptedToken: safeStorage.encryptString(identity.accessToken).toString('base64'),
    scope: identity.scope,
    loggedInAt: new Date().toISOString(),
  };
  await fs.writeFile(credentialsPath, JSON.stringify(record, null, 2), { mode: 0o600 });
  return { provider: record.provider, login: record.login, name: record.name, scope: record.scope, loggedInAt: record.loggedInAt };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'AgentOS CCTV Control',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(fsSync.existsSync(bundledWebEntry) ? bundledWebEntry : path.join(__dirname, 'index.html'));
}

ipcMain.handle('cctv:config', readCctvConfig);
ipcMain.handle('auth:identity', readDesktopIdentity);
ipcMain.handle('auth:github-device', loginWithGithub);
ipcMain.handle('desktop:open-config', async () => {
  const result = await shell.openPath(configPath);
  if (result) return { ok: false, error: result };
  return { ok: true };
});
ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Only HTTPS URLs are allowed.' };
  await shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  dialog.showErrorBox('AgentOS Desktop Error', error.message);
});

export { projectRoot };
