// 文件夹树：用 File System Access API 浏览磁盘文件夹，句柄持久化到 IndexedDB
// （Chrome 支持结构化克隆 FileSystemHandle；重开页面后自动恢复，静默复用已授权权限）
// Electron 桌面模式下走 Node fs IPC（见 desktop.js），句柄为 { kind, path, name } 结构
import { hasFS } from './files.js';
import {
  isDesktop, desktopOpenFolder, desktopRestoreFolder, desktopCloseFolder,
  desktopWalkDir, desktopReadFile, desktopCreateFile
} from './desktop.js';

const DB_NAME = 'inkflow-fs';
const DB_VER = 1;
const DIR_KEY = 'root-dir';
const MAX_DEPTH = 8; // 防止意外遍历巨型目录树
const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i;

let rootHandle = null;
let rootName = '';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const rq = tx.objectStore('handles').get(key);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

function idbSet(db, key, val) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDel(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 打开文件夹选择器，并保存句柄 */
export async function openFolder() {
  if (isDesktop) {
    const h = await desktopOpenFolder();
    if (h) { rootHandle = h; rootName = h.name; }
    return h;
  }
  if (!hasFS || !window.showDirectoryPicker) return null;
  const h = await window.showDirectoryPicker({ mode: 'readwrite' });
  rootHandle = h;
  rootName = h.name;
  try {
    const db = await openDb();
    await idbSet(db, DIR_KEY, h);
  } catch (e) { /* 持久化失败不影响本次会话 */ }
  return h;
}

/** 恢复上次的文件夹句柄（页面重开时调用） */
export async function loadRootHandle() {
  if (isDesktop) {
    const h = await desktopRestoreFolder();
    if (h) { rootHandle = h; rootName = h.name; }
    return h;
  }
  if (!hasFS) return null;
  try {
    const db = await openDb();
    const h = await idbGet(db, DIR_KEY);
    if (h && h.kind === 'directory') {
      // Chrome 对已授权目录会静默返回 granted，未授权则弹窗
      const perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        rootHandle = h;
        rootName = h.name;
      }
    }
  } catch (e) { /* 忽略，等待用户手动打开 */ }
  return rootHandle;
}

export function hasRoot() { return !!rootHandle; }
export function rootLabel() { return rootName; }
export function rootDir() { return rootHandle; }

export async function closeRoot() {
  if (isDesktop) await desktopCloseFolder();
  rootHandle = null;
  rootName = '';
  if (!isDesktop) {
    try {
      const db = await openDb();
      await idbDel(db, DIR_KEY);
    } catch (e) { /* ignore */ }
  }
}

/** 递归遍历目录，目录在前、按名字排序；children 懒加载（null 表示未展开） */
export async function walkDir(dirHandle, depth = 0) {
  if (isDesktop) return desktopWalkDir(dirHandle, depth);
  if (!dirHandle || depth > MAX_DEPTH) return [];
  const out = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        out.push({ name: entry.name, kind: 'dir', handle: entry, children: null, depth });
      } else if (MD_RE.test(entry.name)) {
        out.push({ name: entry.name, kind: 'file', handle: entry, depth });
      }
    }
  } catch (e) { /* 单个目录无权限时跳过 */ }
  out.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1)
      : a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return out;
}

export async function readFile(handle) {
  if (isDesktop) return desktopReadFile(handle);
  const file = await handle.getFile();
  return { name: file.name, text: await file.text(), handle };
}

/** 在目录下新建 Markdown 文件（重名时返回 null） */
export async function createFile(dirHandle, name) {
  if (isDesktop) return desktopCreateFile(dirHandle, name);
  if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
  try {
    return await dirHandle.getFileHandle(name, { create: true });
  } catch (e) {
    return null; // NameError 等
  }
}
