import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WifiManager } from './WifiManager.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({ width: 1100, height: 760, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
}

for (const op of ['scan','connect','disconnect','getConnectionInfo','status','isWifiEnabled','setWifiEnabled','suggestConnection','removeSuggestion','requestPermissions','openWifiSettings','capabilities','isSupported']) {
  ipcMain.handle(`wifi:${op}`, (_event, args) => WifiManager[op](args));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
