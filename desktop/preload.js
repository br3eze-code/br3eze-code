import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentosDesktop', {
  auth: {
    getIdentity: () => ipcRenderer.invoke('auth:identity'),
    loginWithGithub: () => ipcRenderer.invoke('auth:github-device'),
    onGithubPrompt: (callback) => ipcRenderer.on('auth:github-prompt', (_event, prompt) => callback(prompt)),
    onGithubStatus: (callback) => ipcRenderer.on('auth:github-status', (_event, status) => callback(status)),
  },
  cctv: {
    getConfig: () => ipcRenderer.invoke('cctv:config'),
  },
  desktop: {
    openConfig: () => ipcRenderer.invoke('desktop:open-config'),
    openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  },
});
