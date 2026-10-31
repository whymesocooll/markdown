// Tauri 桌面适配层：__TAURI_INTERNALS__ 存在时启用
// 保持 window.inkflowDesktop 桥契约（原 Electron preload 形状），句柄统一为 { kind, path, name }，
// 与浏览器 File System Access handle 同构，使 filetree.js / files.js 可以无感分流。
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const D = () => window.inkflowDesktop;

// 事件 handler 收集：listen 注册是异步的，rendererReady 必须等订阅完成（否则启动参数文件事件会丢）
const beforeCloseHandlers = [];
const openFileHandlers = [];
let eventsReady = Promise.resolve();
if (isDesktop) {
  eventsReady = Promise.all([
    listen('app:before-close', () => { for (const h of beforeCloseHandlers) h(); }),
    listen('app:open-request', (e) => { for (const h of openFileHandlers) h(e.payload); })
  ]).then(() => {}).catch(() => {});
  // 冒烟脚本直接检查 window.inkflowDesktop，保留与 Electron preload 相同的全局桥
  window.inkflowDesktop = {
    openFolder: () => invoke('folder_open'),
    restoreFolder: () => invoke('folder_restore'),
    closeFolder: () => invoke('folder_close'),
    walkDir: (handle, depth) => invoke('fs_walk', { handle, depth }),
    grep: (dir, query) => invoke('fs_grep', { dirPath: dir, query }),
    readFile: (handle) => invoke('fs_read', { handle }),
    statFile: (p) => invoke('fs_stat', { path: p }),
    createFile: (handle, name) => invoke('fs_create', { handle, name }),
    writeAsset: (dir, name, dataUrl) => invoke('fs_write_asset', { dirPath: dir, fileName: name, dataUrl }),
    openFile: () => invoke('file_open'),
    saveFile: (handle, text, mtime) => invoke('file_save', { handle, text, expectedMtime: mtime }),
    saveFileAs: (name, text) => invoke('file_save_as', { name, text }),
    onBeforeClose: (handler) => { beforeCloseHandlers.push(handler); },
    closeReady: () => invoke('close_ready'),
    exportPdf: (html, filename) => invoke('pdf_export', { html, filename }),
    downloadFile: (name, text) => invoke('download_file', { name, text }),
    // 启动参数/二次启动请求打开的文件：渲染进程就绪后上报，主进程逐个下发路径
    rendererReady: () => invoke('renderer_ready'),
    onOpenFile: (handler) => { openFileHandlers.push(handler); }
  };
}

export function desktopOpenFolder() {
  return D().openFolder(); // -> dirHandle | null
}
export function desktopRestoreFolder() {
  return D().restoreFolder();
}
export function desktopCloseFolder() {
  return D().closeFolder();
}
export async function desktopWalkDir(handle, depth) {
  return D().walkDir({ path: handle.path }, depth || 0);
}
/** 文件夹全文搜索（桌面版走 Rust 命令，返回 [{ name, path, line, text, handle }]） */
export function desktopGrep(dir, query) {
  return D().grep(dir, query);
}
export async function desktopReadFile(handle) {
  // 传完整句柄（含 name）
  return D().readFile(handle);
}
export async function desktopStatPath(p) {
  return D().statFile(p);
}
export async function desktopCreateFile(handle, name) {
  return D().createFile({ path: handle.path }, name);
}
/** 图片落盘到 <dir>/assets/，返回相对 dir 的 POSIX 路径（桌面版专用） */
export function desktopWriteAsset(dir, name, dataUrl) {
  return D().writeAsset(dir, name, dataUrl);
}
export function desktopOpenFile() {
  return D().openFile();
}
export async function desktopSaveFile(handle, text, mtime) {
  return D().saveFile(handle, text, mtime);
}
export async function desktopSaveFileAs(name, text) {
  return D().saveFileAs(name, text);
}
export function desktopOnBeforeClose(handler) {
  D().onBeforeClose(handler);
}
export function desktopCloseReady() {
  D().closeReady();
}
/** 渲染进程就绪上报（Rust 侧据此下发启动参数里的待打开文件）；先等事件订阅完成，避免丢失下发事件 */
export function desktopRendererReady() {
  return eventsReady.then(() => D().rendererReady());
}
/** 订阅外部打开文件请求（右键“打开方式”/已运行时再次打开），参数为绝对路径 */
export function desktopOnOpenFile(handler) {
  D().onOpenFile(handler);
}
/** 桌面版导出 PDF：Rust 侧 headless Edge 直出文件（浏览器版走 window.print） */
export async function desktopExportPdf(html, filename) {
  return D().exportPdf(html, filename); // -> { ok, path } | null(取消) | { ok:false, reason }
}
/** 桌面版导出 HTML/MD 落盘：保存对话框直写文件（替代浏览器 Blob 下载） */
export function desktopDownloadFile(name, text) {
  return D().downloadFile(name, text); // -> 保存路径 | null(取消)
}
