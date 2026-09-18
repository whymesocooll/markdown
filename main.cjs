// InkFlow 桌面应用主进程：窗口 + 文件系统 IPC（Node fs + dialog）
const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i;
const MAX_DEPTH = 8;
const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }];
const FOLDER_STORE = () => path.join(app.getPath('userData'), 'folder-path.json');
const WINDOW_STORE = () => path.join(app.getPath('userData'), 'window-state.json');

let mainWindow = null;
let closeApproved = false;
let windowStateTimer = null;

/* ---------------- 窗口状态记忆 ---------------- */
const DEF_BOUNDS = { width: 1240, height: 840 };
function readWindowState() {
  if (process.env.INKFLOW_SMOKE === '1') return {};
  try {
    const s = JSON.parse(fsSync.readFileSync(WINDOW_STORE(), 'utf8'));
    return typeof s === 'object' && s !== null ? s : {};
  } catch (e) { return {}; }
}
function saveWindowState() {
  if (process.env.INKFLOW_SMOKE === '1') return;
  clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const st = { isMaximized: mainWindow.isMaximized() };
    if (!st.isMaximized) {
      const b = mainWindow.getNormalBounds(); // 最大化时保存的是还原态 bounds
      st.x = b.x; st.y = b.y; st.width = b.width; st.height = b.height;
    }
    try { fsSync.writeFileSync(WINDOW_STORE(), JSON.stringify(st), 'utf8'); } catch (e) { /* ignore */ }
  }, 400);
}
function resolveBounds(saved) {
  const b = saved && !saved.isMaximized && typeof saved.x === 'number' ? saved : DEF_BOUNDS;
  const width = Math.max(860, b.width || DEF_BOUNDS.width);
  const height = Math.max(620, b.height || DEF_BOUNDS.height);
  // 校验保存的位置是否仍落在某个显示器可见区；否则使用默认居中
  if (typeof b.x !== 'number' || typeof b.y !== 'number') {
    return { width, height, isMaximized: !!(saved && saved.isMaximized) };
  }
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 60 && b.x + width > a.x + 60
      && b.y < a.y + a.height - 40 && b.y + height > a.y + 40;
  });
  if (onScreen) return { x: b.x, y: b.y, width, height, isMaximized: !!(saved && saved.isMaximized) };
  return { width, height, isMaximized: !!(saved && saved.isMaximized) };
}

function createWindow() {
  const bounds = resolveBounds(readWindowState());
  const winOpts = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 860,
    minHeight: 620,
    title: 'InkFlow',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (bounds.x !== undefined) { winOpts.x = bounds.x; winOpts.y = bounds.y; }
  mainWindow = new BrowserWindow(winOpts);
  // 隐藏菜单栏：快捷键全部由渲染进程处理（Ctrl+S 等不被菜单拦截）
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  if (bounds.isMaximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);
  mainWindow.on('close', (event) => {
    if (closeApproved) return;
    saveWindowState();
    event.preventDefault();
    mainWindow.webContents.send('app:before-close');
  });
  return mainWindow;
}

/* ---------------- 文件系统工具 ---------------- */
function dirHandle(p) {
  return { kind: 'directory', path: p, name: path.basename(p) };
}
function fileHandle(p) {
  return { kind: 'file', path: p, name: path.basename(p) };
}

let atomicWriteSeq = 0;
async function atomicWriteFile(target, text) {
  const tmp = `${target}.inkflow-tmp-${process.pid}-${Date.now()}-${++atomicWriteSeq}`;
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  } finally {
    try { await fs.unlink(tmp); } catch (e) { /* 临时文件可能已被 rename */ }
  }
}

/* ---------------- 启动参数打开文件（右键“打开方式”/双击关联文件） ---------------- */
// 待打开文件队列：渲染进程就绪前先缓存，就绪后逐个下发（渲染进程每开完一个会再报就绪）
const pendingFiles = [];
let rendererReady = false;

// 从命令行参数筛出存在的 Markdown/文本文件（跳过 electron 的 '.' 与各类开关）
function parseFileArgs(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a === '.' || a.startsWith('-')) continue;
    try {
      const p = path.resolve(a);
      if (MD_RE.test(p) && fsSync.existsSync(p) && fsSync.statSync(p).isFile()) out.push(p);
    } catch (e) { /* 无效参数忽略 */ }
  }
  return out;
}

function flushPendingFiles() {
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  const p = pendingFiles.shift();
  if (!p) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:open-request', p);
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

// 文件夹全文搜索：递归遍历 Markdown/文本文件逐行匹配（忽略大小写），
// 每文件最多 5 条、共 200 条、单文件 2MB、深度 8 层，防止巨型目录卡死
ipcMain.handle('fs:grep', async (_e, dirPath, query) => {
  const results = [];
  if (!dirPath || !query) return results;
  const q = String(query).toLowerCase();
  let scanned = 0;
  const walk = async (dir, prefix, depth) => {
    if (depth > MAX_DEPTH || scanned >= 500 || results.length >= 200) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (results.length >= 200 || scanned >= 500) return;
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, p, depth + 1);
      else if (e.isFile() && MD_RE.test(e.name)) {
        scanned++;
        try {
          const st = await fs.stat(full);
          if (st.size > 2 * 1024 * 1024) continue;
          const text = await fs.readFile(full, 'utf8');
          const lines = text.split('\n');
          let perFile = 0;
          for (let i = 0; i < lines.length && results.length < 200; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({ name: e.name, path: p, line: i + 1, text: lines[i].slice(0, 200), handle: fileHandle(full) });
              if (++perFile >= 5) break;
            }
          }
        } catch (err) { /* 无权限/编码异常跳过 */ }
      }
    }
  };
  await walk(dirPath, '', 0);
  return results;
});

ipcMain.handle('fs:read', async (_e, handle) => {
  const text = await fs.readFile(handle.path, 'utf8');
  const stat = await fs.stat(handle.path);
  // name 用 basename 兜底：调用方可能只传 path（旧 desktop.js 就漏传了 name）
  return { name: handle.name || path.basename(handle.path), text, mtime: stat.mtimeMs, handle };
});

// 供渲染层判断最近文件是否仍存在（用于「已失效」标记）
ipcMain.handle('fs:stat', async (_e, p) => {
  try {
    const s = await fs.stat(p);
    return { exists: true, isFile: s.isFile(), mtime: s.mtimeMs };
  } catch (e) {
    return { exists: false, isFile: false, mtime: null };
  }
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

// 粘贴/拖入的图片落盘：写入 <dir>/assets/（文件名去重），返回相对 dirPath 的 POSIX 路径；失败返回 null（渲染层回退 base64）
ipcMain.handle('fs:write-asset', async (_e, dirPath, fileName, dataUrl) => {
  try {
    const m = /^data:[^;]+;base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m || !dirPath) return null;
    const buf = Buffer.from(m[1], 'base64');
    const dir = path.join(dirPath, 'assets');
    await fs.mkdir(dir, { recursive: true });
    const ext = (path.extname(fileName) || '.png').toLowerCase();
    const base = path.basename(fileName, path.extname(fileName)) || 'image';
    let name = base + ext;
    let n = 1;
    while (fsSync.existsSync(path.join(dir, name))) name = `${base}-${n++}${ext}`;
    const target = path.join(dir, name);
    await fs.writeFile(target, buf);
    return path.relative(dirPath, target).replace(/\\/g, '/');
  } catch (e) {
    return null;
  }
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
  const stat = await fs.stat(p);
  return { name: path.basename(p), text, mtime: stat.mtimeMs, handle: fileHandle(p) };
});

ipcMain.handle('file:save', async (_e, handle, text, expectedMtime) => {
  if (expectedMtime != null) {
    const stat = await fs.stat(handle.path);
    if (Math.abs(stat.mtimeMs - expectedMtime) > 0.5) {
      return { conflict: true, currentMtime: stat.mtimeMs };
    }
  }
  await atomicWriteFile(handle.path, text);
  const stat = await fs.stat(handle.path);
  return { name: handle.name || path.basename(handle.path), mtime: stat.mtimeMs, handle };
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
  await atomicWriteFile(r.filePath, text);
  const stat = await fs.stat(r.filePath);
  return { name: path.basename(r.filePath), mtime: stat.mtimeMs, handle: fileHandle(r.filePath) };
});

ipcMain.on('app:close-ready', (event) => {
  if (!mainWindow || BrowserWindow.fromWebContents(event.sender) !== mainWindow) return;
  closeApproved = true;
  mainWindow.close();
});

// 渲染进程启动完成后报就绪；主进程据此下发启动参数中的待打开文件
ipcMain.on('app:renderer-ready', () => {
  rendererReady = true;
  flushPendingFiles();
});

// 导出 PDF：隐藏窗口加载自包含 HTML → printToPDF → 保存对话框落盘
// 返回 { ok: true, path } | null（取消） | { ok: false, reason }
// 测试钩子：INKFLOW_PDF_DIR=<目录> 时跳过对话框直接写入该目录
ipcMain.handle('pdf:export', async (_e, html, filename) => {
  const safeName = String(filename || 'document.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const tmp = path.join(os.tmpdir(), `inkflow-pdf-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    if (!data || !data.length) return { ok: false, reason: '生成的 PDF 为空' };
    let filePath = null;
    if (process.env.INKFLOW_PDF_DIR) {
      filePath = path.join(process.env.INKFLOW_PDF_DIR, safeName);
    } else {
      const r = await dialog.showSaveDialog(mainWindow, {
        defaultPath: safeName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        title: '导出 PDF'
      });
      if (r.canceled || !r.filePath) return null;
      filePath = r.filePath;
    }
    await fs.writeFile(filePath, data);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  } finally {
    win.destroy();
    try { await fs.unlink(tmp); } catch (e) { /* ignore */ }
  }
});

/* ---------------- 启动 ---------------- */
// 单实例锁：应用已运行时再次用“打开方式”启动，把文件转交给已有窗口而不是开新进程。
// 冒烟/截图模式跳过，避免与开发机上正在运行的 InkFlow 实例互相干扰导致测试失败。
const wantLock = !process.env.INKFLOW_SMOKE && !process.env.INKFLOW_SHOT;
if (wantLock && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (wantLock) {
  app.on('second-instance', (_e, argv) => {
    pendingFiles.push(...parseFileArgs(argv));
    flushPendingFiles();
  });
  // macOS：Finder 双击文件时走 open-file 事件
  app.on('open-file', (e, p) => {
    e.preventDefault();
    pendingFiles.push(p);
    flushPendingFiles();
  });
}

app.whenReady().then(() => {
  const argFiles = parseFileArgs(process.argv);
  pendingFiles.push(...argFiles);
  const win = createWindow();

  // 冒烟模式：加载完成后检查渲染进程状态并自动退出（供打包验证）
  if (process.env.INKFLOW_SMOKE === '1') {
    win.webContents.once('did-finish-load', async () => {
      try {
        // 传了文件参数时，额外验证该文件确实被渲染进程打开
        const openCheck = argFiles.length
          ? ` || window.InkFlow?.app?.name !== ${JSON.stringify(path.basename(argFiles[0]))}`
          : '';
        await new Promise((r) => setTimeout(r, argFiles.length ? 3000 : 1500)); // 等编辑器挂载 + 启动参数文件打开
        const smokeDir = process.env.INKFLOW_SMOKE_DIR;
        const js = smokeDir
          ? `(async () => {
              if (typeof window.inkflowDesktop !== 'object' || !document.querySelector('.cm-content')${openCheck}) return false;
              const nodes = await window.inkflowDesktop.walkDir({ path: ${JSON.stringify(smokeDir)} }, 0);
              if (!(Array.isArray(nodes) && nodes.length >= 2 && nodes.some((n) => n.kind === 'dir') && nodes.some((n) => n.kind === 'file'))) return false;
              // 原子保存 + mtime 冲突检测：正确 mtime 保存应成功；旧 mtime 再存应返回冲突
              const fh = { kind: 'file', path: ${JSON.stringify(smokeDir)} + '/a.md', name: 'a.md' };
              const rd = await window.inkflowDesktop.readFile(fh);
              const ok = await window.inkflowDesktop.saveFile(fh, rd.text + '\\n原子保存验证', rd.mtime);
              if (!ok || ok.conflict) return false;
              const stale = await window.inkflowDesktop.saveFile(fh, '应被拦截', rd.mtime);
              return stale && stale.conflict === true;
            })()`
          : `typeof window.inkflowDesktop === "object" && !!document.querySelector(".cm-content")${argFiles.length ? ` && window.InkFlow?.app?.name === ${JSON.stringify(path.basename(argFiles[0]))}` : ''}`;
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
