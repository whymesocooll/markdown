// 渲染进程桥：以 inkflowDesktop 暴露文件系统 IPC（contextIsolation 下安全）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflowDesktop', {
  openFolder: () => ipcRenderer.invoke('folder:open'),
  restoreFolder: () => ipcRenderer.invoke('folder:restore'),
  closeFolder: () => ipcRenderer.invoke('folder:close'),
  walkDir: (handle, depth) => ipcRenderer.invoke('fs:walk', handle, depth),
  readFile: (handle) => ipcRenderer.invoke('fs:read', handle),
  createFile: (handle, name) => ipcRenderer.invoke('fs:create', handle, name),
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (handle, text) => ipcRenderer.invoke('file:save', handle, text),
  saveFileAs: (name, text) => ipcRenderer.invoke('file:saveAs', name, text),
  onBeforeClose: (handler) => ipcRenderer.on('app:before-close', () => handler()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  exportPdf: (html, filename) => ipcRenderer.invoke('pdf:export', html, filename)
});
