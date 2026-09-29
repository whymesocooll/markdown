// src/save-pipeline.js —— 文档身份与保存管线：标题/路径渲染、脏标记、保存状态条、
// 本地暂存 checkpoint、文件自动保存（autosave）、关闭前落盘（finishSessionBeforeClose）
import * as F from './files.js';
import { app, settings } from './state.js';
import { $ } from './icons.js';
import { toast } from './dialogs.js';
import { refreshVaultSection } from './sidebar.js';
import { debounce } from './utils.js';

export function text() { return app.view.state.doc.toString(); }

export function markDirty(d) {
  app.dirty = d;
  $('#dirtyDot').classList.toggle('on', d);
  renderSaveState();
}

export function setTitle(name, path) {
  app.name = name || '未命名.md';
  if (path) app.path = path;
  $('#docTitle').textContent = app.name;
  document.title = app.name + ' — InkFlow';
  renderPath();
}

function renderPath() {
  const el = $('#docPath');
  const p = F.isDesktop ? (app.path || '') : '';
  el.hidden = !p;
  if (p) {
    el.textContent = p;
    const t = $('#docTitle');
    t.title = '双击重命名\n' + p;
  } else {
    $('#docTitle').title = '双击重命名';
  }
}

function setSaveState(message, state = 'saved', detail = '') {
  const el = $('#saveState');
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
  el.title = detail || message;
  el.setAttribute('aria-label', detail || message);
}

function saveStateDetail(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || err.reason || '';
}
export function renderSaveState() {
  if (app.vaultError) {
    setSaveState('临时备份不可用', 'error', '本地文档暂存不可用，请保存或导出备份');
    return;
  }
  if (app.checkpointState === 'failed') {
    setSaveState('本地暂存失败', 'error', saveStateDetail(app.checkpointError) || '本地暂存失败');
    return;
  }
  // 文件保存态只在有文件句柄时才生效；无句柄（新建/本地暂存文档）时只看本地暂存态
  if (app.handle) {
    if (app.saveState === 'conflict') {
      setSaveState('文件已被外部修改', 'error', '文件已被其他程序修改，自动保存已暂停');
      return;
    }
    if (app.saveState === 'failed') {
      setSaveState('自动保存失败（已本地暂存）', 'error', '自动保存到文件失败，但本地暂存仍可恢复');
      return;
    }
    if (app.saveState === 'saving-file') {
      setSaveState('正在自动保存到文件…', 'saving');
      return;
    }
    if (app.saveState === 'saved-file') {
      setSaveState(app.checkpointState === 'failed' ? '已自动保存到文件（本地暂存失败）' : '已自动保存到文件', 'saved');
      return;
    }
  }
  if (app.checkpointState === 'saving') {
    setSaveState('正在本地暂存…', 'saving');
    return;
  }
  if (app.checkpointState === 'saved') {
    setSaveState(app.handle && app.dirty ? '未保存到文件（已本地暂存）' : '已自动暂存', app.handle && app.dirty ? 'warn' : 'saved');
    return;
  }
  setSaveState(app.dirty ? '未保存' : '已保存', app.dirty ? 'warn' : 'saved');
}

export function checkpointNeedsAttention() {
  return app.checkpointState === 'saving' || app.checkpointState === 'failed' || text() !== app.checkpointText;
}

function sameHandle(a, b) {
  if (F.isDesktop) return !!a && !!b && a.path === b.path;
  return a === b;
}

export async function checkpoint({ notifyFailure = true, snapshotText } = {}) {
  const snapshot = { id: app.docId, name: app.name, text: snapshotText ?? text(), seq: ++app.saveSeq };
  app.checkpointState = 'saving';
  app.checkpointError = null;
  renderSaveState();
  const r = await F.upsertDoc(snapshot);
  if (snapshot.seq !== app.saveSeq || snapshot.id !== app.docId) return r;
  if (!r.ok) {
    app.checkpointState = 'failed';
    app.checkpointError = r.error;
    renderSaveState();
    if (notifyFailure) toast('本地暂存失败，请立即保存或导出备份', { type: 'error', duration: 7000 });
    return r;
  }
  app.docId = r.value.id;
  app.checkpointText = snapshot.text;
  app.checkpointState = 'saved';
  app.checkpointError = null;
  F.setLastDocId(app.docId);
  refreshVaultSection();
  renderSaveState();
  F.putHistorySnapshot({ name: snapshot.name, text: snapshot.text }); // 每日历史快照（内部自限频）
  return r;
}

async function autoSaveFile({ checkpointOk, snapshotText } = {}) {
  if (!app.handle || !app.dirty) return;
  if (app.saveState === 'conflict') return; // 冲突未处理前停止自动覆盖，避免每轮防抖都重试并反复报错
  const snapshot = {
    docId: app.docId,
    handle: app.handle,
    name: app.name,
    text: snapshotText ?? text(),
    mtime: app.mtime
  };
  app.saveState = 'saving-file';
  renderSaveState();
  try {
    const r = await F.saveFile(snapshot);
    const current = snapshot.docId === app.docId
      && sameHandle(snapshot.handle, app.handle)
      && snapshot.text === text();
    if (!current) return;
    if (r.conflict) {
      // 文件被外部改动：停止自动覆盖，保留脏标记并提示用户
      app.saveState = 'conflict';
      markDirty(true);
      renderSaveState();
      toast('文件已被其他程序修改，自动保存已暂停，请手动处理', { type: 'error', duration: 7000 });
      return;
    }
    app.handle = r.handle || snapshot.handle;
    app.mtime = r.mtime ?? snapshot.mtime;
    app.savedText = snapshot.text;
    app.saveState = 'saved-file';
    markDirty(false);
    renderSaveState();
  } catch (e) {
    const current = snapshot.docId === app.docId && sameHandle(snapshot.handle, app.handle);
    if (!current || !checkpointOk) return;
    app.saveState = 'failed';
    renderSaveState();
    toast('自动保存失败：' + (e.message || e), { type: 'error', duration: 7000 });
  }
}

export const autosave = debounce(async () => {
  if (app.closing) return;
  const t = text(); // 一次序列化，本地暂存与文件保存共用，避免防抖到期时全文序列化两遍
  const local = await checkpoint({ snapshotText: t });
  await autoSaveFile({ checkpointOk: local.ok, snapshotText: t });
}, () => Math.max(200, settings.autosaveMs || 700));

// 临时备份只服务于当前会话。关闭桌面窗口前先落盘，再清空全部临时内容。
export async function finishSessionBeforeClose() {
  if (app.closing) return false;
  app.closing = true;
  try {
    await checkpoint({ notifyFailure: false });
    const content = text();
    let saved = null;
    if (app.handle) {
      saved = await F.saveFile({ handle: app.handle, name: app.name, text: content, mtime: app.mtime });
    } else if (app.dirty || content !== app.savedText) {
      saved = await F.saveFileAs({ name: app.name, text: content });
      if (!saved) return false;
    }
    if (saved && saved.conflict) {
      // 文件被外部改动：不清空临时备份、不关闭，让用户先处理冲突
      toast('文件已被其他程序修改，已保留本地暂存，请先处理冲突', { type: 'error', duration: 7000 });
      return false;
    }
    if (saved) {
      app.handle = saved.handle || app.handle;
      app.path = saved.handle?.path || app.path;
      app.mtime = saved.mtime ?? app.mtime;
      setTitle(saved.name, app.path);
      app.savedText = content;
      markDirty(false);
    }
    const cleared = await F.clearDocs();
    if (!cleared.ok) throw cleared.error || new Error('无法清理临时备份');
    return true;
  } catch (e) {
    toast('关闭前保存失败：' + (e.message || e), { type: 'error', duration: 7000 });
    return false;
  } finally {
    if (app.closing) app.closing = false;
  }
}
