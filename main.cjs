// InkFlow 桌面应用主进程：窗口 + 文件系统 IPC（Node fs + dialog）
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const MAX_DEPTH = 8;
const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }];
const FOLDER_STORE = () => path.join(app.getPath('userData'), 'folder-path.json');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 860,
    minHeight: 620,
    title: 'InkFlow',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // 隐藏菜单栏：快捷键全部由渲染进程处理（Ctrl+S 等不被菜单拦截）
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  return mainWindow;
}

/* ---------------- 文件系统工具 ---------------- */
function dirHandle(p) {
  return { kind: 'directory', path: p, name: path.basename(p) };
}
function fileHandle(p) {
  return { kind: 'file', path: p, name: path.basename(p) };
}

async function walkDir(dirPath, depth) {
  if (depth > MAX_DEPTH) return [];
  const out = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        out.push({ name: e.name, kind: 'dir', handle: dirHandle(path.join(dirPath, e.name)), depth });
      } else if (e.isFile() && MD_RE.test(e.name)) {
        out.push({ name: e.name, kind: 'file', handle: fileHandle(path.join(dirPath, e.name)), depth });
      }
    }
  } catch (e) { /* 无权限目录跳过 */ }
  out.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1)
      : a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return out;
}

/* ---------------- IPC ---------------- */
ipcMain.handle('folder:open', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '打开文件夹'
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  try { await fs.writeFile(FOLDER_STORE(), JSON.stringify(p), 'utf8'); } catch (e) { /* ignore */ }
  return dirHandle(p);
});

ipcMain.handle('folder:restore', async () => {
  try {
    const p = JSON.parse(await fs.readFile(FOLDER_STORE(), 'utf8'));
    await fs.access(p);
    return dirHandle(p);
  } catch (e) { return null; }
});

ipcMain.handle('folder:close', async () => {
  try { await fs.unlink(FOLDER_STORE()); } catch (e) { /* ignore */ }
  return true;
});

ipcMain.handle('fs:walk', (_e, handle, depth) => walkDir(handle.path, depth || 0));

ipcMain.handle('fs:read', async (_e, handle) => {
  const text = await fs.readFile(handle.path, 'utf8');
  // name 用 basename 兜底：调用方可能只传 path（旧 desktop.js 就漏传了 name）
  return { name: handle.name || path.basename(handle.path), text, handle };
});

ipcMain.handle('fs:create', async (_e, dirHandle_, name) => {
  let n = name;
  if (!/\.(md|markdown|txt)$/i.test(n)) n += '.md';
  const p = path.join(dirHandle_.path, n);
  try {
    await fs.writeFile(p, '', { flag: 'wx' }); // 已存在则抛错
  } catch (e) {
    return null;
  }
  return fileHandle(p);
});

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: MD_FILTER,
    title: '打开 Markdown 文件'
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const text = await fs.readFile(p, 'utf8');
  return { name: path.basename(p), text, handle: fileHandle(p) };
});

ipcMain.handle('file:save', async (_e, handle, text) => {
  await fs.writeFile(handle.path, text, 'utf8');
  return { name: handle.name || path.basename(handle.path), handle };
});

ipcMain.handle('file:saveAs', async (_e, name, text) => {
  let suggested = name;
  if (!/\.(md|markdown|txt)$/i.test(suggested)) suggested += '.md';
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggested,
    filters: MD_FILTER,
    title: '另存为'
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, text, 'utf8');
  return { name: path.basename(r.filePath), handle: fileHandle(r.filePath) };
});

/* ---------------- 启动 ---------------- */
app.whenReady().then(() => {
  const win = createWindow();

  // 冒烟模式：加载完成后检查渲染进程状态并自动退出（供打包验证）
  if (process.env.INKFLOW_SMOKE === '1') {
    win.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500)); // 等编辑器挂载
        const smokeDir = process.env.INKFLOW_SMOKE_DIR;
        const js = smokeDir
          ? `(async () => {
              if (typeof window.inkflowDesktop !== 'object' || !document.querySelector('.cm-content')) return false;
              const nodes = await window.inkflowDesktop.walkDir({ path: ${JSON.stringify(smokeDir)} }, 0);
              return Array.isArray(nodes) && nodes.length >= 2 && nodes.some((n) => n.kind === 'dir') && nodes.some((n) => n.kind === 'file');
            })()`
          : 'typeof window.inkflowDesktop === "object" && !!document.querySelector(".cm-content")';
        const ok = await win.webContents.executeJavaScript(js);
        console.log('SMOKE_RESULT ' + (ok ? 'PASS' : 'FAIL'));
        app.exit(ok ? 0 : 1);
      } catch (e) {
        console.log('SMOKE_RESULT FAIL ' + (e && e.message));
        app.exit(1);
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 截图模式：加载完成后截取窗口画面保存并退出（供验证 UI 渲染）
  // INKFLOW_THEME=<主题名> 时先写入本地设置并刷新，截取指定主题的画面
  if (process.env.INKFLOW_SHOT) {
    let themed = false;
    win.webContents.on('did-finish-load', async () => {
      try {
        if (process.env.INKFLOW_THEME && !themed) {
          themed = true;
          await win.webContents.executeJavaScript(
            `(() => { const s = JSON.parse(localStorage.getItem('inkflow:settings') || '{}');
              s.theme = ${JSON.stringify(process.env.INKFLOW_THEME)};
              localStorage.setItem('inkflow:settings', JSON.stringify(s));
              location.reload(); })()`);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
        const image = await win.capturePage();
        require('node:fs').writeFileSync(process.env.INKFLOW_SHOT, image.toPNG());
        console.log('SHOT_SAVED');
        app.exit(0);
      } catch (e) {
        console.log('SHOT_FAIL ' + (e && e.message));
        app.exit(1);
      }
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
