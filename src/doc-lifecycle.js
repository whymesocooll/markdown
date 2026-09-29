// src/doc-lifecycle.js —— 文档生命周期动作：新建/打开/另存/导入内容、导出（HTML/PDF/MD/富文本）、
// 历史快照恢复、最近文件记录与重开。渲染细节见 sidebar.js，保存细节见 save-pipeline.js
import * as F from './files.js';
import { app, readRecents, saveRecents } from './state.js';
import { $ } from './icons.js';
import { toast, showConfirm } from './dialogs.js';
import { renderFiles, buildOutline } from './sidebar.js';
import { text, markDirty, setTitle, renderSaveState, checkpointNeedsAttention, checkpoint } from './save-pipeline.js';
import { buildStandaloneHtmlAsync, downloadFile, printToPdf, buildRichFragment } from './exporter.js';
import { themeFamily, effectiveTheme } from './theme.js';
import { setDoc } from './editor.js';
import { desktopRendererReady } from './desktop.js';
import { dismissWelcome } from './welcome.js';
import { uid, fmtTime } from './utils.js';

/** 恢复历史快照：以快照内容新建会话文档（不恢复文件句柄） */
export async function restoreHistory(id) {
  const snap = F.getHistory(id);
  if (!snap) return;
  const choice = await showConfirm({
    title: '恢复历史版本',
    message: `把编辑器内容替换为 ${fmtTime(snap.updated)} 的「${snap.name}」快照（约 ${snap.text.length} 字符）？当前文档未保存的修改将丢失。`,
    actions: [
      { label: '恢复', value: 'restore', kind: 'primary' },
      { label: '取消', value: 'cancel', kind: 'ghost' }
    ]
  });
  if (choice !== 'restore') return;
  app.docId = uid();
  app.handle = null;
  app.path = '';
  app.mtime = null;
  app.saveState = 'idle';
  setTitle(snap.name, '');
  setDoc(app.view, snap.text);
  app.savedText = snap.text;
  app.checkpointText = '';
  markDirty(false);
  await checkpoint();
  renderFiles();
  app.view.focus();
  toast('已恢复历史版本');
}

/* ---------------- 最近文件（桌面版） ---------------- */
export function recordRecentFile(path, name) {
  if (!F.isDesktop || !path) return;
  const list = readRecents().filter((r) => r.path !== path);
  list.unshift({ name: name || path.split(/[\\/]/).pop(), path, at: Date.now() });
  saveRecents(list);
  if (!$('#panelFiles').classList.contains('hidden')) renderFiles();
}

export async function reopenRecent(i) {
  const r = readRecents()[i];
  if (!r) return;
  const st = F.isDesktop ? await F.statDesktopPath(r.path) : null;
  if (st && !st.exists) {
    toast('文件不存在或已被移动', { type: 'error', duration: 7000 });
    return;
  }
  if (!(await confirmDiscard())) return;
  try {
    const rd = await F.openDesktopPath(r.path);
    await loadContent(rd.name, rd.text, rd.handle, rd.mtime);
    toast(`已打开 ${rd.name}`);
  } catch (e) {
    toast('打开文件失败：' + (e.message || e), { type: 'error', duration: 7000 });
  }
}

export async function removeRecent(i) {
  const list = readRecents();
  list.splice(i, 1);
  saveRecents(list);
  renderFiles();
}

/* ---------------- 文件操作 ---------------- */
export async function confirmDiscard() {
  if (!app.dirty && !checkpointNeedsAttention()) return true;
  const choice = await showConfirm({
    title: '文档尚未保存',
    message: '当前文档有尚未保存的改动，接下来要怎么处理？',
    actions: [
      { label: '保存并继续', value: 'save', kind: 'primary' },
      { label: '不保存继续', value: 'discard', kind: 'ghost' },
      { label: '取消', value: 'cancel', kind: 'ghost' }
    ]
  });
  if (choice === 'discard') return true;
  if (choice === 'save') return (await saveDoc(false)) === 'saved';
  return false;
}

export async function newDoc() {
  if (!(await confirmDiscard())) return;
  app.docId = uid();
  app.handle = null;
  app.path = '';
  app.mtime = null;
  app.saveState = 'idle';
  setTitle('未命名.md', '');
  setDoc(app.view, '');
  app.savedText = '';
  app.checkpointText = '';
  markDirty(false);
  const r = await checkpoint();
  if (!r.ok) toast('新文档未能本地暂存，请立即保存或导出备份');
  renderFiles();
  app.view.focus();
}

export async function openDoc() {
  if (!(await confirmDiscard())) return;
  try {
    const r = await F.openFile();
    if (!r) return; // 用户取消（Electron dialog 返回 null）
    await loadContent(r.name, r.text, r.handle, r.mtime);
    toast(`已打开 ${r.name}`);
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 浏览器文件选择器被取消
    toast('打开文件失败：' + (e && e.message ? e.message : e), { type: 'error', duration: 7000 });
  }
}

// 桌面版：打开启动参数/外部请求指定的文件（右键“打开方式”、已运行时再次打开）
export async function openDocFromPath(p) {
  try {
    dismissWelcome(); // 欢迎页还开着时先收起，直接呈现打开的文档
    if (!(await confirmDiscard())) return;
    const r = await F.openDesktopPath(p);
    await loadContent(r.name, r.text, r.handle, r.mtime);
    toast(`已打开 ${r.name}`);
  } catch (e) {
    toast('打开文件失败：' + (e.message || e));
  } finally {
    // 已开完一个，上报就绪让主进程继续下发队列里的下一个（如有）
    desktopRendererReady();
  }
}

export async function loadContent(name, content, handle, mtime = null) {
  app.docId = uid();
  app.handle = handle || null;
  app.path = app.handle?.path || '';
  app.mtime = app.handle ? mtime : null;
  app.saveState = 'idle'; // 清掉上一文档残留的 conflict/failed 状态
  setTitle(name, app.path);
  if (app.path) recordRecentFile(app.path, app.name);
  setDoc(app.view, content);
  app.savedText = content;
  app.checkpointText = '';
  app.checkpointState = 'saving';
  markDirty(false);
  const r = await checkpoint();
  if (!r.ok) return r;
  renderFiles();
  buildOutline();
  return r;
}

/** 打开本地暂存文档（文件面板点击 / 快速打开共用） */
export async function openVaultDoc(d) {
  if (!(await confirmDiscard())) return;
  app.docId = d.id;
  app.handle = null;
  app.saveState = 'idle';
  setTitle(d.name);
  setDoc(app.view, d.text);
  app.savedText = d.text;
  app.checkpointText = d.text;
  app.checkpointState = 'saved';
  markDirty(false);
  F.setLastDocId(d.id);
  buildOutline();
  renderFiles();
  app.view.focus();
}

export async function saveDoc(forceAs) {
  const content = text();
  try {
    const r = forceAs
      ? await F.saveFileAs({ name: app.name, text: content })
      : await F.saveFile({ handle: app.handle, name: app.name, text: content, mtime: app.mtime });
    if (!r) return 'cancelled'; // 用户取消了保存对话框（Electron）
    if (r.conflict) {
      app.saveState = 'conflict';
      toast('文件已被其他程序修改，请先重新打开或使用另存为', { type: 'error', duration: 7000 });
      renderSaveState();
      return 'conflict';
    }
    app.handle = r.handle;
    app.path = r.handle?.path || '';
    app.mtime = r.mtime ?? app.mtime;
    setTitle(r.name, app.path);
    app.savedText = content;
    app.saveState = 'idle';
    markDirty(false);
    const local = await checkpoint();
    if (!local.ok) toast('文件已保存，但本地暂存失败');
    renderFiles();
    if (app.path) recordRecentFile(app.path, r.name);
    toast((F.isDesktop || F.hasFS) ? `已保存到 ${r.name}` : `已导出 ${r.name}`);
    return 'saved';
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('保存失败：' + (e.message || e), { type: 'error', duration: 7000 });
    return 'failed';
  }
}

function baseName() {
  return app.name.replace(/\.(md|markdown|txt)$/i, '') || 'document';
}

export async function exportHtml() {
  const html = await buildStandaloneHtmlAsync(text(), { title: baseName(), theme: themeFamily(effectiveTheme()) });
  downloadFile(baseName() + '.html', html, 'text/html;charset=utf-8');
  toast('已导出 HTML');
}
export async function exportPdf() {
  // PDF 配色跟随当前主题色系（亮色主题出白底，暗色出深底）
  const r = await printToPdf(text(), { title: baseName(), theme: themeFamily(effectiveTheme()) });
  if (r === 'saved') toast('已导出 PDF');
  else if (r === 'cancelled') return; // 用户取消，不打扰
  else if (r && r.startsWith('failed:')) toast('导出 PDF 失败：' + r.slice(7));
  else toast('已调起打印，选择「另存为 PDF」');
}
export function exportMd() {
  downloadFile(baseName() + '.md', text(), 'text/markdown;charset=utf-8');
  toast('已导出 Markdown');
}
/** 复制为富文本 HTML（含 KaTeX 样式与内联 mermaid SVG），粘进邮件/Word/公众号保留排版 */
export async function copyAsHtml() {
  const html = await buildRichFragment(text(), { theme: themeFamily(effectiveTheme()) });
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('当前环境剪贴板不支持');
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text()], { type: 'text/plain' })
    })]);
    toast('已复制为富文本 HTML');
  } catch (e) {
    toast('复制失败：' + (e.message || e), { type: 'error', duration: 7000 });
  }
}
