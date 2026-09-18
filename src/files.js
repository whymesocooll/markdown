// 文件读写：Electron 桌面模式走 Node fs IPC；浏览器优先 File System Access API（可原地保存），否则回退到上传/下载
import { downloadFile } from './exporter.js';
import { uid } from './utils.js';
import { isDesktop, desktopOpenFile, desktopReadFile, desktopStatPath, desktopSaveFile, desktopSaveFileAs, desktopWriteAsset } from './desktop.js';

export const hasFS = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
export { isDesktop } from './desktop.js';

const MD_TYPES = [{
  description: 'Markdown',
  accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.txt'] }
}];

export async function openFile() {
  if (isDesktop) return desktopOpenFile();
  if (hasFS && window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({ types: MD_TYPES, multiple: false });
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain';
    const cancelled = () => {
      const err = new Error('cancelled');
      err.name = 'AbortError'; // 与 FSA 选择器取消一致，openDoc 据此静默返回
      reject(err);
    };
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return cancelled();
      resolve({ name: file.name, text: await file.text(), handle: null });
    };
    input.oncancel = cancelled; // 用户取消选择时结束 Promise，而不是永远挂起
    input.click();
  });
}

export async function readDroppedFile(file) {
  return { name: file.name, text: await file.text(), handle: null };
}

/** 桌面版图片落盘：写入 dir/assets/（文件名去重），返回相对 dir 的 POSIX 路径；失败/非桌面返回 null */
export async function writeAssetDesktop(dir, fileName, dataUrl) {
  if (!isDesktop || !dir) return null;
  return desktopWriteAsset(dir, fileName, dataUrl);
}

/** 浏览器图片落盘：写入目录句柄下 assets/ 子目录（文件名去重），返回文件名；失败返回 null */
export async function writeAssetBrowser(dirHandle, fileName, blob) {
  if (!dirHandle) return null;
  try {
    const assets = await dirHandle.getDirectoryHandle('assets', { create: true });
    const ext = (fileName.match(/(\.[a-z0-9]+)$/i) || ['', '.png'])[1];
    const base = fileName.slice(0, fileName.length - ext.length) || 'image';
    let name = base + ext;
    for (let n = 1; n < 1000; n++) {
      try {
        await assets.getFileHandle(name, { create: false }); // 已存在 → 换名重试
        name = `${base}-${n}${ext}`;
      } catch (e) { break; }
    }
    const fh = await assets.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return name;
  } catch (e) {
    return null;
  }
}

/** 桌面版按绝对路径打开文件（启动参数/外部打开请求），返回结构与 openFile 一致 */
export async function openDesktopPath(p) {
  // 主进程 fs:read 依赖 handle.path 读文件，name 缺省时用 basename 兜底
  return desktopReadFile({ kind: 'file', path: p });
}
export function statDesktopPath(p) {
  return desktopStatPath(p);
}

export async function saveToHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  await writable.close();
}

export async function saveFile({ handle, name, text, mtime }) {
  if (handle) {
    if (isDesktop) return desktopSaveFile(handle, text, mtime);
    await saveToHandle(handle, text);
    return { handle, name };
  }
  return saveFileAs({ name, text });
}

export async function saveFileAs({ name, text }) {
  const suggested = /\.(md|markdown|txt)$/i.test(name || '') ? name : `${name || 'untitled'}.md`;
  if (isDesktop) return desktopSaveFileAs(name, text);
  if (hasFS) {
    const handle = await window.showSaveFilePicker({ suggestedName: suggested, types: MD_TYPES });
    await saveToHandle(handle, text);
    return { handle, name: handle.name || suggested };
  }
  downloadFile(suggested, text, 'text/markdown;charset=utf-8');
  return { handle: null, name: suggested };
}

/* ---------------- 本地文档库（IndexedDB） ---------------- */
const VAULT = 'inkflow:vault';
const LAST = 'inkflow:last';
const DB_NAME = 'inkflow-vault';
const DB_VER = 2;
const DOC_STORE = 'docs';
const HIST_STORE = 'history';

let vaultDb = null;
let vaultCache = new Map();
let historyCache = new Map();
let vaultReady = false;
let vaultInit = null;
let vaultWriteFailureForTest = null;

function result(ok, value, error) {
  return ok ? { ok: true, value } : { ok: false, error };
}

function openVaultDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const store = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
        store.createIndex('updated', 'updated');
      }
      if (!db.objectStoreNames.contains(HIST_STORE)) {
        db.createObjectStore(HIST_STORE, { keyPath: 'id' }); // v2 新增：历史快照（跨会话保留）
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('无法打开本地文档库'));
    req.onblocked = () => reject(new Error('本地文档库被其他页面占用'));
  });
}

function requestValue(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('本地文档库请求失败'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('本地文档库写入已取消'));
    tx.onerror = () => reject(tx.error || new Error('本地文档库写入失败'));
  });
}

function legacyDocs() {
  try {
    const docs = JSON.parse(localStorage.getItem(VAULT) || '[]');
    return Array.isArray(docs) ? docs.filter((d) => d && d.id) : [];
  } catch (e) {
    return [];
  }
}

async function loadCache() {
  const tx = vaultDb.transaction(DOC_STORE, 'readonly');
  const docs = await requestValue(tx.objectStore(DOC_STORE).getAll());
  vaultCache = new Map(docs.map((doc) => [doc.id, doc]));
  const tx2 = vaultDb.transaction(HIST_STORE, 'readonly');
  const snaps = await requestValue(tx2.objectStore(HIST_STORE).getAll());
  historyCache = new Map(snaps.map((doc) => [doc.id, doc]));
}

async function migrateLegacy() {
  const docs = legacyDocs();
  if (!docs.length) return;
  const tx = vaultDb.transaction(DOC_STORE, 'readwrite');
  const store = tx.objectStore(DOC_STORE);
  for (const raw of docs) {
    if (vaultCache.has(String(raw.id))) continue;
    const now = Date.now();
    store.put({
      id: String(raw.id),
      name: String(raw.name || '未命名.md'),
      text: String(raw.text || ''),
      created: Number(raw.created) || now,
      updated: Number(raw.updated) || now
    });
  }
  await transactionDone(tx);
  localStorage.removeItem(VAULT);
}

export async function initVault() {
  if (vaultReady) return result(true);
  if (!vaultInit) {
    vaultInit = (async () => {
      vaultDb = await openVaultDb();
      await loadCache();
      await migrateLegacy();
      await loadCache();
      vaultReady = true;
    })();
  }
  try {
    await vaultInit;
    return result(true);
  } catch (error) {
    vaultInit = null;
    return result(false, null, error);
  }
}

export function listDocs() {
  return Array.from(vaultCache.values()).sort((a, b) => b.updated - a.updated);
}

export function getDoc(id) {
  return vaultCache.get(id) || null;
}

export function setVaultFailureForTest(error) {
  vaultWriteFailureForTest = error || null;
}

export async function upsertDoc({ id, name, text }) {
  if (!vaultReady) return result(false, null, new Error('本地文档库尚未准备完成'));
  const old = vaultCache.get(id);
  const now = Date.now();
  const doc = {
    id: id || uid(),
    name: name || (old && old.name) || '未命名.md',
    text: String(text || ''),
    created: (old && old.created) || now,
    updated: now
  };
  try {
    if (vaultWriteFailureForTest) throw vaultWriteFailureForTest;
    const tx = vaultDb.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).put(doc);
    await transactionDone(tx);
    vaultCache.set(doc.id, doc);
    return result(true, doc);
  } catch (error) {
    return result(false, null, error);
  }
}

export async function deleteDoc(id) {
  if (!vaultReady) return result(false, null, new Error('本地文档库尚未准备完成'));
  try {
    const tx = vaultDb.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).delete(id);
    await transactionDone(tx);
    vaultCache.delete(id);
    return result(true);
  } catch (error) {
    return result(false, null, error);
  }
}

export async function clearDocs() {
  if (!vaultReady) return result(false, null, new Error('本地文档库尚未准备完成'));
  try {
    const tx = vaultDb.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).clear();
    await transactionDone(tx);
    vaultCache.clear();
    setLastDocId('');
    return result(true);
  } catch (error) {
    return result(false, null, error);
  }
}

export function setLastDocId(id) {
  try { localStorage.setItem(LAST, id || ''); return result(true); } catch (error) { return result(false, null, error); }
}
export function getLastDocId() {
  try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; }
}

/* ---------------- 历史快照（每日一份，保留 7 天，跨会话保留） ---------------- */
let lastSnap = { day: '', text: null, at: 0 };

function snapDayKey() {
  const d = new Date();
  return `snap-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 每日快照：同一天内容未变跳过；变化则至少间隔 60 秒落一次，最多保留 7 份 */
export async function putHistorySnapshot({ name, text }) {
  if (!vaultReady) return;
  const day = snapDayKey();
  const now = Date.now();
  if (day === lastSnap.day && (text === lastSnap.text || now - lastSnap.at < 60000)) return;
  try {
    const doc = { id: day, name: name || '未命名.md', text: String(text || ''), updated: now };
    const tx = vaultDb.transaction(HIST_STORE, 'readwrite');
    tx.objectStore(HIST_STORE).put(doc);
    await transactionDone(tx);
    historyCache.set(doc.id, doc);
    lastSnap = { day, text: doc.text, at: now };
    await pruneHistory();
  } catch (error) { /* 快照失败不影响主流程 */ }
}

async function pruneHistory() {
  const all = Array.from(historyCache.values()).sort((a, b) => b.updated - a.updated);
  for (const old of all.slice(7)) {
    try {
      const tx = vaultDb.transaction(HIST_STORE, 'readwrite');
      tx.objectStore(HIST_STORE).delete(old.id);
      await transactionDone(tx);
    } catch (error) { /* ignore */ }
    historyCache.delete(old.id);
  }
}

export function listHistory() {
  return Array.from(historyCache.values()).sort((a, b) => b.updated - a.updated);
}

export function getHistory(id) {
  return historyCache.get(id) || null;
}

export async function deleteHistory(id) {
  if (!vaultReady) return result(false, null, new Error('本地文档库尚未准备完成'));
  try {
    const tx = vaultDb.transaction(HIST_STORE, 'readwrite');
    tx.objectStore(HIST_STORE).delete(id);
    await transactionDone(tx);
    historyCache.delete(id);
    return result(true);
  } catch (error) {
    return result(false, null, error);
  }
}
