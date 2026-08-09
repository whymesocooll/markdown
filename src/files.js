// 文件读写：Electron 桌面模式走 Node fs IPC；浏览器优先 File System Access API（可原地保存），否则回退到上传/下载
import { downloadFile } from './exporter.js';
import { uid } from './utils.js';
import { isDesktop, desktopOpenFile, desktopSaveFile, desktopSaveFileAs } from './desktop.js';

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

export async function saveToHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  await writable.close();
}

export async function saveFile({ handle, name, text }) {
  if (handle) {
    if (isDesktop) return desktopSaveFile(handle, text);
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

/* ---------------- 本地文档库（localStorage） ---------------- */
const VAULT = 'inkflow:vault';
const LAST = 'inkflow:last';

function readVault() {
  try { return JSON.parse(localStorage.getItem(VAULT) || '[]'); } catch (e) { return []; }
}
function writeVault(list) {
  try { localStorage.setItem(VAULT, JSON.stringify(list)); } catch (e) { /* 配额溢出忽略 */ }
}

export function listDocs() {
  return readVault().sort((a, b) => b.updated - a.updated);
}

export function getDoc(id) {
  return readVault().find((d) => d.id === id) || null;
}

export function upsertDoc({ id, name, text }) {
  const list = readVault();
  const now = Date.now();
  let doc = list.find((d) => d.id === id);
  if (!doc) {
    doc = { id: id || uid(), name: name || '未命名.md', text, created: now, updated: now };
    list.push(doc);
  } else {
    doc.name = name || doc.name;
    doc.text = text;
    doc.updated = now;
  }
  writeVault(list);
  return doc;
}

export function deleteDoc(id) {
  writeVault(readVault().filter((d) => d.id !== id));
}

export function setLastDocId(id) {
  try { localStorage.setItem(LAST, id || ''); } catch (e) { /* ignore */ }
}
export function getLastDocId() {
  try { return localStorage.getItem(LAST) || ''; } catch (e) { return ''; }
}
