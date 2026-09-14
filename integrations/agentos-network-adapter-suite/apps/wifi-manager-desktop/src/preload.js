import { contextBridge, ipcRenderer } from 'electron';
const ops = ['scan','connect','disconnect','getConnectionInfo','status','isWifiEnabled','setWifiEnabled','suggestConnection','removeSuggestion','requestPermissions','openWifiSettings','capabilities','isSupported'];
const api = Object.fromEntries(ops.map(op => [op, args => ipcRenderer.invoke(`wifi:${op}`, args)]));
contextBridge.exposeInMainWorld('WifiManager', api);
