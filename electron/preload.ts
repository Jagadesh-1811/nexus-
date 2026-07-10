import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('synapse', {
  meetings: {
    list: () => ipcRenderer.invoke('meetings:list'),
    get: (id: string) => ipcRenderer.invoke('meetings:get', id),
    approve: (id: string, updates: any) => ipcRenderer.invoke('meetings:approve', id, updates)
  },
  ingest: {
    upload: (filePath: string) => ipcRenderer.invoke('ingest:upload', filePath),
    uploadBuffer: (buffer: ArrayBuffer) => ipcRenderer.invoke('ingest:upload-buffer', buffer),
    onProgress: (callback: (event: any, progress: any) => void) => {
      ipcRenderer.on('ingest:progress', callback);
      return () => ipcRenderer.removeListener('ingest:progress', callback);
    }
  },
  memory: {
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    ask: (question: string) => ipcRenderer.invoke('memory:ask', question)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: any) => ipcRenderer.invoke('settings:update', settings),
    ollamaStatus: () => ipcRenderer.invoke('settings:ollama-status'),
    ollamaPull: (model: string) => ipcRenderer.invoke('settings:ollama-pull', model),
    getAutocapture: () => ipcRenderer.invoke('settings:get-autocapture'),
    updateAutocapture: (settings: any) => ipcRenderer.invoke('settings:update-autocapture', settings)
  },
  auth: {
    getSession: () => ipcRenderer.invoke('auth:get-session'),
    signIn: (credentials: any) => ipcRenderer.invoke('auth:sign-in', credentials),
    signUp: (credentials: any) => ipcRenderer.invoke('auth:sign-up', credentials),
    signOut: () => ipcRenderer.invoke('auth:sign-out')
  },
  system: {
    health: () => ipcRenderer.invoke('system:health'),
    dockerStatus: () => ipcRenderer.invoke('system:docker-status'),
    dockerStart: () => ipcRenderer.invoke('system:docker-start'),
    dockerStop: () => ipcRenderer.invoke('system:docker-stop'),
    getResources: () => ipcRenderer.invoke('system:resources')
  },
  native: {
    openFileDialog: () => ipcRenderer.invoke('native:open-file-dialog'),
    showNotification: (title: string, body: string) => ipcRenderer.invoke('native:show-notification', title, body),
    revealExplorer: (path: string) => ipcRenderer.invoke('native:reveal-explorer', path),
    minimize: () => ipcRenderer.invoke('win-minimize'),
    maximize: () => ipcRenderer.invoke('win-maximize')
  }
});
