// 渲染进程桥：以 inkflowDesktop 暴露文件系统 IPC（contextIsolation 下安全）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inkflowDesktop', {
  openFolder: () => ipcRenderer.invoke('folder:open'),
  restoreFolder: () => ipcRenderer.invoke('folder:restore'),
  closeFolder: () => ipcRenderer.invoke('folder:close'),
  walkDir: (handle, depth) => ipcRenderer.invoke('fs:walk', handle, depth),
  readFile: (handle) => ipcRenderer.invoke('fs:read', handle),
  statFile: (p) => ipcRenderer.invoke('fs:stat', p),
  createFile: (handle, name) => ipcRenderer.invoke('fs:create', handle, name),
  writeAsset: (dir, name, dataUrl) => ipcRenderer.invoke('fs:write-asset', dir, name, dataUrl),
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (handle, text, mtime) => ipcRenderer.invoke('file:save', handle, text, mtime),
  saveFileAs: (name, text) => ipcRenderer.invoke('file:saveAs', name, text),
  onBeforeClose: (handler) => ipcRenderer.on('app:before-close', () => handler()),
  closeReady: () => ipcRenderer.send('app:close-ready'),
  exportPdf: (html, filename) => ipcRenderer.invoke('pdf:export', html, filename),
  // 启动参数/二次启动请求打开的文件：渲染进程就绪后上报，主进程逐个下发路径
  rendererReady: () => ipcRenderer.send('app:renderer-ready'),
  onOpenFile: (handler) => ipcRenderer.on('app:open-request', (_e, p) => handler(p))
});
