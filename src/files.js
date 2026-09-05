// 文件读写：Electron 桌面模式走 Node fs IPC；浏览器优先 File System Access API（可原地保存），否则回退到上传/下载
import { downloadFile } from './exporter.js';
import { uid } from './utils.js';
import { isDesktop, desktopOpenFile, desktopReadFile, desktopSaveFile, desktopSaveFileAs } from './desktop.js';

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
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return reject(new Error('cancelled'));
      resolve({ name: file.name, text: await file.text(), handle: null });
    };
    input.click();
  });
}

export async function readDroppedFile(file) {
  return { name: file.name, text: await file.text(), handle: null };
}

/** 桌面版按绝对路径打开文件（启动参数/外部打开请求），返回结构与 openFile 一致 */
export async function openDesktopPath(p) {
  // 主进程 fs:read 依赖 handle.path 读文件，name 缺省时用 basename 兜底
  return desktopReadFile({ kind: 'file', path: p });
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
const DB_VER = 1;
const DOC_STORE = 'docs';

let vaultDb = null;
let vaultCache = new Map();
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
