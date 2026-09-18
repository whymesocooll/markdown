// Electron 桌面适配层：preload 暴露的 inkflowDesktop 存在时启用
// 句柄统一为 { kind, path, name } 结构，与浏览器 File System Access handle 同构，
// 使 filetree.js / files.js 可以无感分流。
export const isDesktop = typeof window !== 'undefined' && !!window.inkflowDesktop;
const D = () => window.inkflowDesktop;

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
export async function desktopReadFile(handle) {
  // 传完整句柄（含 name），否则主进程 fs:read 拿不到文件名
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
/** 渲染进程就绪上报（主进程据此下发启动参数里的待打开文件） */
export function desktopRendererReady() {
  D().rendererReady();
}
/** 订阅外部打开文件请求（右键“打开方式”/已运行时再次打开），参数为绝对路径 */
export function desktopOnOpenFile(handler) {
  D().onOpenFile(handler);
}
/** 桌面版导出 PDF：主进程 printToPDF 直出文件（浏览器版走 window.print） */
export async function desktopExportPdf(html, filename) {
  return D().exportPdf(html, filename); // -> { ok, path } | null(取消) | { ok:false, reason }
}
