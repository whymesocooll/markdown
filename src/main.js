// InkFlow —— 对标 Typora 的所见即所得 Markdown 编辑器
import './styles.css';
import 'katex/dist/katex.min.css';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditor, setDoc } from './editor.js';
import { sourceModeEffect, sourceModeField, refreshEffect } from './livepreview.js';
import { loadMermaid, renderMermaid } from './mermaid.js';
import * as C from './commands.js';
import * as F from './files.js';
import * as FT from './filetree.js';
import { buildStandaloneHtml, buildStandaloneHtmlAsync, downloadFile, printToPdf, renderMarkdown } from './exporter.js';
import { debounce, countWords, panguSpacing, fmtTime, uid } from './utils.js';
import { themeCssToBlocks, blockToCss } from './obsidian.js';

/* ---------------- DOM 工具 ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const P = (d) => `<path d="${d}"/>`;
const svg = (inner, size = 17) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICON = {
  sidebar: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`),
  file: svg(P('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z') + P('M14 3v5h5')),
  folder: svg(P('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')),
  save: svg(P('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z') + P('M17 21v-8H7v8M7 3v5h8')),
  download: svg(P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('M7 10l5 5 5-5') + P('M12 15V3')),
  quote: svg(P('M6 17h3l2-4V7H5v6h3zM15 17h3l2-4V7h-6v6h3z')),
  ul: svg(P('M9 6h11M9 12h11M9 18h11') + P('M4.5 6h.01M4.5 12h.01M4.5 18h.01')),
  ol: svg(P('M10 6h10M10 12h10M10 18h10') + P('M4 6h1v4M4 10h2') + P('M4 15h2v1.5H4.5V18H6')),
  task: svg(P('M9 11l2 2 4-4') + `<rect x="3" y="4" width="18" height="16" rx="2"/>`),
  link: svg(P('M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1') + P('M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1')),
  image: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>` + P('M21 16l-5-5-9 9')),
  table: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/>` + P('M3 10h18M9 10v10M15 10v10')),
  hr: svg(P('M3 12h18')),
  code: svg(P('M16 18l6-6-6-6M8 6l-6 6 6 6')),
  codeblock: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/>` + P('M9.5 11l-1.5 1.5L9.5 14M14.5 11l1.5 1.5-1.5 1.5')),
  search: svg(`<circle cx="11" cy="11" r="7"/>` + P('M20 20l-3.5-3.5')),
  undo: svg(P('M3 7v6h6') + P('M3.5 13a9 9 0 1 0 2.6-6.4L3 9.5')),
  redo: svg(P('M21 7v6h-6') + P('M20.5 13a9 9 0 1 1-2.6-6.4L21 9.5')),
  sun: svg(`<circle cx="12" cy="12" r="4"/>` + P('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4')),
  moon: svg(P('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z')),
  settings: svg(P('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5')),
  eye: svg(P('M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z') + `<circle cx="12" cy="12" r="3"/>`),
  focus: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>` + P('M12 2v3M12 19v3M2 12h3M19 12h3')),
  type: svg(P('M4 7V5h16v2M12 5v14M9 19h6')),
  trash: svg(P('M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13'), 14),
  plus: svg(P('M12 5v14M5 12h14'))
};

/* ---------------- 全局状态 ---------------- */
const SETTINGS_KEY = 'inkflow:settings';
const defaults = {
  theme: 'dark', fontKind: 'sans', fontSize: 16, lineHeight: 1.8,
  pageWidth: 800, justify: false, focusMode: false, typewriter: false,
  sidebar: true, customCss: ''
};
let settings = Object.assign({}, defaults, readJSON(SETTINGS_KEY));

const app = {
  view: null,
  docId: '',
  name: '未命名.md',
  handle: null,
  dirty: false,
  savedText: '',
  checkpointText: '',
  checkpointState: 'saved',
  checkpointError: null,
  saveSeq: 0,
  sideTab: 'outline'
};

/* ---------------- 文件夹树状态 ---------------- */
const treeState = {
  nodes: [],      // 顶层节点
  map: new Map(), // path -> 节点（含已懒加载的 children）
  expanded: new Set() // 已展开的目录 path
};

function indexTree(nodes) {
  for (const n of nodes) {
    treeState.map.set(n.path, n);
    if (n.children) indexTree(n.children);
  }
}

async function loadTreeFromRoot(h) {
  treeState.nodes = (await FT.walkDir(h, 0)).map((c) => ({ ...c, path: c.name }));
  treeState.map.clear();
  indexTree(treeState.nodes);
  treeState.expanded.clear();
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

/* ---------------- 主题与外观 ---------------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function effectiveTheme() {
  return settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme;
}
// 主题展示名（设置面板 / 提示条）
const THEME_NAMES = {
  dark: '墨夜', light: '素白', dracula: '德古拉', nord: '北极光',
  'tokyo-night': '东京之夜', 'solarized-light': '日光', auto: '跟随系统',
};
// 导出 HTML 只支持暗/亮两套文档样式，新主题归入所属色系
function themeFamily(t) {
  if (t && t.startsWith('obs-')) return t.endsWith('-light') ? 'light' : 'dark';
  return t === 'light' || t === 'solarized-light' ? 'light' : 'dark';
}

/* ---------------- Obsidian 主题导入 ---------------- */
const OBS_STORE = 'inkflow:obsidian-themes';
let obsidianThemes = []; // [{ name, key, dark, light }] —— dark/light 为 InkFlow 变量集或 null
function loadObsidianThemes() {
  try { obsidianThemes = JSON.parse(localStorage.getItem(OBS_STORE) || '[]'); } catch (e) { obsidianThemes = []; }
}
function saveObsidianThemes() {
  try { localStorage.setItem(OBS_STORE, JSON.stringify(obsidianThemes)); } catch (e) { /* ignore */ }
}
function injectObsidianCss() {
  let st = document.getElementById('obsidian-theme-css');
  if (!st) { st = document.createElement('style'); st.id = 'obsidian-theme-css'; document.head.appendChild(st); }
  st.textContent = obsidianThemes
    .map((t) => blockToCss(t.key, t.dark) + blockToCss(t.key + '-light', t.light))
    .join('\n');
}
function obsThemeLabel(key) {
  const t = obsidianThemes.find((x) => x.key === key || x.key + '-light' === key);
  if (!t) return null;
  return t.name + (key.endsWith('-light') ? ' · 亮色' : ' · 暗色');
}
function refreshThemeSelect() {
  const sel = $('#setTheme');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = [
    '<option value="dark">墨夜（暗色）</option>',
    '<option value="dracula">德古拉 Dracula</option>',
    '<option value="nord">北极光 Nord</option>',
    '<option value="tokyo-night">东京之夜 Tokyo Night</option>',
    '<option value="light">素白（亮色）</option>',
    '<option value="solarized-light">日光 Solarized</option>',
    '<option value="auto">跟随系统</option>',
    ...obsidianThemes.map((t) =>
      `<option value="${t.key}">${escapeAttr(t.name)} · 暗色（Obsidian）</option>` +
      (t.light ? `<option value="${t.key}-light">${escapeAttr(t.name)} · 亮色（Obsidian）</option>` : '')),
  ].join('');
  sel.value = cur;
}
function renderObsidianList() {
  const el = $('#obsThemeList');
  if (!el) return;
  if (!obsidianThemes.length) { el.textContent = '暂无（从 Obsidian 社区下载 theme.css 后导入）'; return; }
  el.innerHTML = obsidianThemes.map((t, i) =>
    `<span class="obs-theme-item">${escapeAttr(t.name)}<button class="btn ghost" data-del-obs="${i}" title="删除" style="height:22px;padding:0 8px;margin-left:4px">✕</button></span>`).join(' ');
}
async function importObsidianTheme(file) {
  const css = await file.text();
  const blocks = themeCssToBlocks(css);
  if (!blocks.dark && !blocks.light) throw new Error('未找到 Obsidian 主题变量');
  const base = (file.name.replace(/\.css$/i, '').trim() || 'Obsidian');
  const slug = base.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'obsidian';
  let key = 'obs-' + slug, n = 2;
  while (obsidianThemes.some((t) => t.key === key)) key = 'obs-' + slug + '-' + (n++);
  obsidianThemes.push({ name: base, key, dark: blocks.dark || null, light: blocks.light || null });
  saveObsidianThemes();
  injectObsidianCss();
  refreshThemeSelect();
  renderObsidianList();
  settings.theme = blocks.dark ? key : key + '-light';
  saveSettings();
  applyAppearance();
  return base;
}
function applyAppearance() {
  const th = effectiveTheme();
  document.documentElement.dataset.theme = th;
  const root = document.documentElement.style;
  root.setProperty('--editor-size', settings.fontSize + 'px');
  root.setProperty('--editor-lh', String(settings.lineHeight));
  root.setProperty('--page-width', settings.pageWidth + 'px');
  root.setProperty('--editor-font',
    settings.fontKind === 'serif' ? 'var(--font-serif)'
      : settings.fontKind === 'mono' ? 'var(--font-mono)' : 'var(--font-ui)');
  const appEl = $('#app');
  appEl.classList.toggle('justify', !!settings.justify);
  appEl.classList.toggle('focus-mode', !!settings.focusMode);
  appEl.classList.toggle('typewriter', !!settings.typewriter);
  appEl.classList.toggle('no-sidebar', !settings.sidebar);
  $('#userCss').textContent = settings.customCss || '';
  $('#btnTheme').innerHTML = th === 'dark' ? ICON.sun : ICON.moon;
  $('#btnFocus').classList.toggle('on', !!settings.focusMode);
  $('#btnTypewriter').classList.toggle('on', !!settings.typewriter);
  $('#btnSidebar').classList.toggle('active', !!settings.sidebar);
  // 主题变化时刷新装饰，让 mermaid 等带主题的 widget 重建
  if (app.view) app.view.dispatch({ effects: refreshEffect.of(null) });
}
mq.addEventListener('change', () => { if (settings.theme === 'auto') applyAppearance(); });

/* ---------------- 提示条 ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------------- 文档状态 ---------------- */
function text() { return app.view.state.doc.toString(); }

function markDirty(d) {
  app.dirty = d;
  $('#dirtyDot').classList.toggle('on', d);
  $('#saveState').textContent = d ? '未保存' : '已保存';
}

function setTitle(name) {
  app.name = name || '未命名.md';
  $('#docTitle').textContent = app.name;
  document.title = app.name + ' — InkFlow';
}

function checkpointNeedsAttention() {
  return app.checkpointState === 'saving' || app.checkpointState === 'failed' || text() !== app.checkpointText;
}

function sameHandle(a, b) {
  if (F.isDesktop) return !!a && !!b && a.path === b.path;
  return a === b;
}

async function checkpoint({ notifyFailure = true } = {}) {
  const snapshot = { id: app.docId, name: app.name, text: text(), seq: ++app.saveSeq };
  app.checkpointState = 'saving';
  app.checkpointError = null;
  $('#saveState').textContent = '正在本地暂存…';
  const r = await F.upsertDoc(snapshot);
  if (snapshot.seq !== app.saveSeq || snapshot.id !== app.docId) return r;
  if (!r.ok) {
    app.checkpointState = 'failed';
    app.checkpointError = r.error;
    $('#saveState').textContent = '本地暂存失败';
    if (notifyFailure) toast('本地暂存失败，请立即保存或导出备份');
    return r;
  }
  app.docId = r.value.id;
  app.checkpointText = snapshot.text;
  app.checkpointState = 'saved';
  app.checkpointError = null;
  F.setLastDocId(app.docId);
  renderFiles();
  $('#saveState').textContent = app.handle && app.dirty ? '未保存到文件（已本地暂存）' : '已自动暂存';
  return r;
}

async function autoSaveFile({ checkpointOk } = {}) {
  if (!app.handle || !app.dirty) return;
  const snapshot = {
    docId: app.docId,
    handle: app.handle,
    name: app.name,
    text: text()
  };
  $('#saveState').textContent = '正在自动保存到文件…';
  try {
    const r = await F.saveFile(snapshot);
    const current = snapshot.docId === app.docId
      && sameHandle(snapshot.handle, app.handle)
      && snapshot.text === text();
    if (!current) return;
    app.handle = r.handle || snapshot.handle;
    app.savedText = snapshot.text;
    markDirty(false);
    $('#saveState').textContent = checkpointOk ? '已自动保存到文件' : '已自动保存到文件（本地暂存失败）';
  } catch (e) {
    const current = snapshot.docId === app.docId && sameHandle(snapshot.handle, app.handle);
    if (!current || !checkpointOk) return;
    $('#saveState').textContent = '自动保存失败（已本地暂存）';
    toast('自动保存失败：' + (e.message || e));
  }
}

const autosave = debounce(async () => {
  const local = await checkpoint();
  await autoSaveFile({ checkpointOk: local.ok });
}, 700);

/* ---------------- 大纲 ---------------- */
let outline = [];
function buildOutline() {
  const doc = app.view.state.doc;
  const items = [];
  let fence = null;
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    const fm = /^\s{0,3}(```+|~~~+)/.exec(t);
    if (fence) { if (fm && t.trim().startsWith(fence)) fence = null; continue; }
    if (fm) { fence = fm[1]; continue; }
    const m = /^(#{1,6})\s+(.*)$/.exec(t);
    if (m) items.push({ level: m[1].length, title: m[2].replace(/[*_`~]/g, '').trim() || '(空标题)', line: i, pos: doc.line(i).from });
  }
  outline = items;
  const panel = $('#panelOutline');
  if (!items.length) {
    panel.innerHTML = '<div class="empty-tip">还没有标题。<br>用 # 开头写个标题，大纲会自动出现。</div>';
    return;
  }
  panel.innerHTML = items.map((it, i) =>
    `<button class="outline-item" data-level="${it.level}" data-idx="${i}" title="${escapeAttr(it.title)}">${escapeAttr(it.title)}</button>`
  ).join('');
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function highlightOutline() {
  if (!outline.length) return;
  const pos = app.view.state.selection.main.head;
  let idx = -1;
  for (let i = 0; i < outline.length; i++) if (outline[i].pos <= pos) idx = i;
  $$('#panelOutline .outline-item').forEach((el, i) => el.classList.toggle('active', i === idx));
}

/* ---------------- 文档库 ---------------- */
function renderFiles() {
  const panel = $('#panelFiles');
  panel.innerHTML = treeSectionHtml() + vaultSectionHtml();
}

function treeSectionHtml() {
  if (!FT.hasRoot()) {
    return `<button class="tree-open" title="打开一个文件夹，浏览其中的 Markdown 文件">📂 打开文件夹</button>`;
  }
  return `
    <div class="tree-toolbar">
      <span class="tree-root" title="当前文件夹：${escapeAttr(FT.rootLabel())}">📁 ${escapeAttr(FT.rootLabel())}</span>
      <button class="tree-act" data-tree="new" title="在文件夹中新建 Markdown 文件">＋</button>
      <button class="tree-act" data-tree="refresh" title="刷新文件夹">⟳</button>
      <button class="tree-act" data-tree="close" title="关闭文件夹">×</button>
    </div>
    <div class="tree">${treeNodesHtml(treeState.nodes)}</div>
    <div class="vault-head">本地文档</div>`;
}

function treeNodesHtml(nodes) {
  return nodes.map((n) => {
    if (n.kind === 'dir') {
      const open = treeState.expanded.has(n.path);
      return `<div class="tree-node">
        <button class="tree-row tree-dir${open ? ' open' : ''}" data-toggle="${escapeAttr(n.path)}">${open ? '▾' : '▸'} ${escapeAttr(n.name)}</button>
        ${open ? `<div class="tree-children">${n.children ? treeNodesHtml(n.children) : '<div class="tree-loading">…</div>'}</div>` : ''}
      </div>`;
    }
    // Electron 模式 handle 是 {kind,path,name}，按 path 比较；浏览器模式是 FileSystemHandle 引用比较
    const key = (h) => (h && h.path !== undefined ? h.path : h);
    const active = key(n.handle) === key(app.handle) ? ' active' : '';
    return `<button class="tree-row tree-file${active}" data-open="${escapeAttr(n.path)}" title="${escapeAttr(n.name)}">📄 ${escapeAttr(n.name)}</button>`;
  }).join('');
}

function vaultSectionHtml() {
  const list = F.listDocs();
  if (!list.length) {
    return '<div class="empty-tip">本地暂无文档。<br>写点内容会自动暂存在浏览器里。</div>';
  }
  return list.map((d) => `
    <div class="file-item${d.id === app.docId ? ' active' : ''}" data-id="${d.id}">
      <div class="fi-main">
        <div class="fi-name">${escapeAttr(d.name)}</div>
        <div class="fi-meta">${fmtTime(d.updated)} · ${d.text.length} 字符</div>
      </div>
      <button class="fi-del" data-del="${d.id}" title="删除">${ICON.trash}</button>
    </div>`).join('');
}

/* ---------------- 文件夹树交互 ---------------- */
async function toggleDir(path) {
  const node = treeState.map.get(path);
  if (!node || node.kind !== 'dir') return;
  if (treeState.expanded.has(path)) {
    treeState.expanded.delete(path);
  } else {
    treeState.expanded.add(path);
    if (node.children === null) {
      node.children = (await FT.walkDir(node.handle, node.depth + 1))
        .map((c) => ({ ...c, path: `${path}/${c.name}` }));
      indexTree(node.children);
    }
  }
  renderFiles();
}

async function openFolderTree() {
  const h = await FT.openFolder();
  if (!h) return;
  await loadTreeFromRoot(h);
  renderFiles();
  toast(`已打开文件夹 ${FT.rootLabel()}`);
}

async function handleTreeAction(act) {
  if (act === 'new') {
    const name = window.prompt('新文件名：', '未命名.md');
    if (!name) return;
    const h = await FT.createFile(FT.rootDir(), name);
    if (!h) { toast('创建失败：文件已存在或名称无效'); return; }
    const r = await FT.readFile(h);
    await loadContent(r.name, r.text, r.handle);
    renderFiles();
    toast(`已创建 ${r.name}`);
  } else if (act === 'refresh') {
    await loadTreeFromRoot(FT.rootDir());
    renderFiles();
    toast('已刷新');
  } else if (act === 'close') {
    await FT.closeRoot();
    treeState.nodes = [];
    treeState.map.clear();
    treeState.expanded.clear();
    renderFiles();
    toast('已关闭文件夹');
  }
}

/* ---------------- 文件操作 ---------------- */
async function confirmDiscard() {
  if (!app.dirty && !checkpointNeedsAttention()) return true;
  return window.confirm('当前文档有尚未安全保存的改动，确定要放弃吗？');
}

async function newDoc() {
  if (!(await confirmDiscard())) return;
  app.docId = uid();
  app.handle = null;
  setTitle('未命名.md');
  setDoc(app.view, '');
  app.savedText = '';
  app.checkpointText = '';
  markDirty(false);
  const r = await checkpoint();
  if (!r.ok) toast('新文档未能本地暂存，请立即保存或导出备份');
  renderFiles();
  app.view.focus();
}

async function openDoc() {
  if (!(await confirmDiscard())) return;
  try {
    const r = await F.openFile();
    await loadContent(r.name, r.text, r.handle);
    toast(`已打开 ${r.name}`);
  } catch (e) { /* 用户取消 */ }
}

async function loadContent(name, content, handle) {
  app.docId = uid();
  app.handle = handle || null;
  setTitle(name);
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

async function saveDoc(forceAs) {
  const content = text();
  try {
    const r = forceAs
      ? await F.saveFileAs({ name: app.name, text: content })
      : await F.saveFile({ handle: app.handle, name: app.name, text: content });
    if (!r) return; // 用户取消了保存对话框（Electron）
    app.handle = r.handle;
    setTitle(r.name);
    app.savedText = content;
    markDirty(false);
    const local = await checkpoint();
    if (!local.ok) toast('文件已保存，但本地暂存失败');
    renderFiles();
    toast((F.isDesktop || F.hasFS) ? `已保存到 ${r.name}` : `已导出 ${r.name}`);
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('保存失败：' + (e.message || e));
  }
}

function baseName() {
  return app.name.replace(/\.(md|markdown|txt)$/i, '') || 'document';
}

async function exportHtml() {
  const html = await buildStandaloneHtmlAsync(text(), { title: baseName(), theme: themeFamily(effectiveTheme()) });
  downloadFile(baseName() + '.html', html, 'text/html;charset=utf-8');
  toast('已导出 HTML');
}
async function exportPdf() {
  const r = await printToPdf(text(), { title: baseName(), theme: 'light' });
  if (r === 'saved') toast('已导出 PDF');
  else if (r === 'cancelled') return; // 用户取消，不打扰
  else if (r && r.startsWith('failed:')) toast('导出 PDF 失败：' + r.slice(7));
  else toast('已调起打印，选择「另存为 PDF」');
}
function exportMd() {
  downloadFile(baseName() + '.md', text(), 'text/markdown;charset=utf-8');
  toast('已导出 Markdown');
}

/* ---------------- 工具栏 ---------------- */
function buildToolbar() {
  const tb = $('#toolbar');
  const items = [
    ['undo', ICON.undo, '撤销  Ctrl+Z'],
    ['redo', ICON.redo, '重做  Ctrl+Y'],
    ['|'],
    ['heading', `<b style="font:600 13px var(--font-ui)">H</b>`, '标题  Ctrl+1~6'],
    ['bold', `<b style="font:700 14px var(--font-serif)">B</b>`, '加粗  Ctrl+B'],
    ['italic', `<i style="font:italic 600 14px var(--font-serif)">I</i>`, '斜体  Ctrl+I'],
    ['strike', `<span style="font:600 13px var(--font-serif);text-decoration:line-through">S</span>`, '删除线  Ctrl+Shift+X'],
    ['highlight', `<span style="font:600 13px var(--font-serif);background:var(--mark-bg);padding:0 2px;border-radius:2px">M</span>`, '高亮  Ctrl+Shift+H'],
    ['icode', ICON.code, '行内代码  Ctrl+`'],
    ['|'],
    ['quote', ICON.quote, '引用  Ctrl+Shift+Q'],
    ['ul', ICON.ul, '无序列表  Ctrl+Shift+L'],
    ['ol', ICON.ol, '有序列表  Ctrl+Shift+O'],
    ['task', ICON.task, '任务列表  Ctrl+Shift+T'],
    ['|'],
    ['link', ICON.link, '链接  Ctrl+K'],
    ['image', ICON.image, '图片  Ctrl+Shift+I'],
    ['table', ICON.table, '表格'],
    ['codeblock', ICON.codeblock, '代码块  Ctrl+Shift+K'],
    ['math', `<span style="font:600 14px var(--font-serif)">Σ</span>`, '行内公式  Ctrl+Shift+M'],
    ['mathblock', `<span style="font:600 12px var(--font-serif)">Σ²</span>`, '公式块'],
    ['hr', ICON.hr, '分隔线  Ctrl+Shift+-'],
    ['|'],
    ['search', ICON.search, '查找替换  Ctrl+F']
  ];
  tb.innerHTML = items.map(([act, icon, title]) =>
    act === '|' ? '<div class="divider"></div>'
      : `<button class="icon-btn" data-act="${act}" title="${title}">${icon}</button>`
  ).join('');
  $('#btnSidebar').innerHTML = ICON.sidebar;
  $('#btnSettings').innerHTML = ICON.settings;
}

const ACTIONS = {
  undo: (v) => undo(v),
  redo: (v) => redo(v),
  bold: (v) => C.toggleWrap(v, '**'),
  italic: (v) => C.toggleWrap(v, '*'),
  strike: (v) => C.toggleWrap(v, '~~'),
  highlight: (v) => C.toggleWrap(v, '=='),
  icode: (v) => C.toggleWrap(v, '`'),
  quote: (v) => C.toggleLinePrefix(v, 'quote'),
  ul: (v) => C.toggleLinePrefix(v, 'ul'),
  ol: (v) => C.toggleLinePrefix(v, 'ol'),
  task: (v) => C.toggleLinePrefix(v, 'task'),
  link: (v) => C.insertLink(v),
  image: (v) => C.insertImage(v),
  table: (v) => C.insertTable(v),
  codeblock: (v) => C.insertCodeBlock(v),
  math: (v) => C.insertInlineMath(v),
  mathblock: (v) => C.insertMathBlock(v),
  hr: (v) => C.insertHr(v),
  search: (v) => openSearchPanel(v)
};

/* ---------------- 菜单 ---------------- */
function closeMenus() { $$('.menu').forEach((m) => m.classList.add('hidden')); }
function toggleMenu(id, anchor) {
  const m = $(id);
  const wasHidden = m.classList.contains('hidden');
  closeMenus();
  if (wasHidden) {
    m.classList.remove('hidden');
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      m.style.position = 'fixed';
      m.style.left = Math.min(r.left, window.innerWidth - 210) + 'px';
      m.style.top = r.bottom + 4 + 'px';
      m.style.right = 'auto';
    }
  }
}

/* ---------------- 设置面板 ---------------- */
function openSettings() {
  refreshThemeSelect();
  renderObsidianList();
  $('#setTheme').value = settings.theme;
  $('#setFont').value = settings.fontKind;
  $('#setSize').value = settings.fontSize;
  $('#setSizeVal').textContent = settings.fontSize + 'px';
  $('#setLh').value = settings.lineHeight;
  $('#setLhVal').textContent = settings.lineHeight;
  $('#setWidth').value = settings.pageWidth;
  $('#setWidthVal').textContent = settings.pageWidth + 'px';
  $('#setJustify').checked = !!settings.justify;
  $('#setCss').value = settings.customCss || '';
  $('#overlay').classList.remove('hidden');
  $('#settingsDlg').classList.remove('hidden');
}
function closeSettings() {
  $('#overlay').classList.add('hidden');
  $('#settingsDlg').classList.add('hidden');
}

/* ---------------- 启动 ---------------- */
async function boot() {
  buildToolbar();

  const pasteHandler = EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData && event.clipboardData.items;
      if (!items) return false;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (!file) continue;
          event.preventDefault();
          const reader = new FileReader();
          reader.onload = () => {
            const r = view.state.selection.main;
            const md = `![粘贴的图片](${reader.result})`;
            view.dispatch({ changes: { from: r.from, to: r.to, insert: md }, selection: { anchor: r.from + md.length } });
          };
          reader.readAsDataURL(file);
          return true;
        }
      }
      return false;
    }
  });

  app.view = createEditor({
    parent: $('#editor'),
    doc: '',
    extra: [pasteHandler],
    onChange: () => {
      markDirty(text() !== app.savedText);
      buildOutline();
      updateStatus();
      autosave();
    },
    onSelection: () => {
      updateStatus();
      highlightOutline();
      if (settings.typewriter) {
        requestAnimationFrame(() => {
          const head = app.view.state.selection.main.head;
          app.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
        });
      }
    }
  });

  // 载入上次文档
  const vault = await F.initVault();
  if (!vault.ok) {
    $('#saveState').textContent = '本地文档库不可用';
    toast('本地文档库不可用，请及时保存或导出备份');
  }
  const lastId = F.getLastDocId();
  const last = vault.ok && lastId ? F.getDoc(lastId) : null;
  if (last) {
    app.docId = last.id;
    setTitle(last.name);
    setDoc(app.view, last.text);
    app.savedText = last.text;
    app.checkpointText = last.text;
    app.checkpointState = 'saved';
  } else {
    app.docId = uid();
    setTitle('欢迎.md');
    setDoc(app.view, WELCOME);
    app.savedText = WELCOME;
    app.checkpointText = '';
    if (vault.ok) await checkpoint({ notifyFailure: false });
  }
  markDirty(false);
  buildOutline();
  renderFiles();
  updateStatus();
  // Obsidian 主题 CSS 需在 applyAppearance 之前注入（当前主题可能是导入的）
  loadObsidianThemes();
  injectObsidianCss();
  refreshThemeSelect();
  applyAppearance();
  wireEvents();
  app.view.focus();

  // 恢复上次打开的文件夹（异步；无授权时静默跳过）
  FT.loadRootHandle().then(async (h) => {
    if (h) {
      await loadTreeFromRoot(h);
      renderFiles();
    }
  });

  // 供自动化测试 / 高级用户使用的调试入口
  window.InkFlow = {
    app, F, buildStandaloneHtml, buildStandaloneHtmlAsync, renderMarkdown, panguSpacing, FT, treeState,
    renderMermaid, loadMermaid
  };
}

function updateStatus() {
  const state = app.view.state;
  const t = state.doc.toString();
  const { words, chars } = countWords(t);
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  $('#stWords').textContent = `${words} 词`;
  $('#stChars').textContent = `${chars} 字符`;
  $('#stPos').textContent = `行 ${line.number} : 列 ${head - line.from + 1}`;
  $('#stRead').textContent = `约 ${Math.max(1, Math.round(words / 300))} 分钟`;
}

function wireEvents() {
  // 工具栏
  $('#toolbar').addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'heading') { toggleMenu('#headingMenu', btn); return; }
    const fn = ACTIONS[act];
    if (fn) fn(app.view);
  });

  $('#headingMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (!b) return;
    C.setHeading(app.view, Number(b.dataset.level));
    closeMenus();
  });

  // 顶栏
  $('#btnSidebar').addEventListener('click', () => {
    settings.sidebar = !settings.sidebar; saveSettings(); applyAppearance();
  });
  $('#btnNew').addEventListener('click', newDoc);
  $('#btnOpen').addEventListener('click', openDoc);
  $('#btnSave').addEventListener('click', () => saveDoc(false));
  $('#btnExport').addEventListener('click', (e) => toggleMenu('#exportMenu', e.currentTarget));
  $('#exportMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-exp]');
    if (!b) return;
    closeMenus();
    if (b.dataset.exp === 'md') exportMd();
    if (b.dataset.exp === 'html') exportHtml();
    if (b.dataset.exp === 'pdf') exportPdf();
    if (b.dataset.exp === 'saveas') saveDoc(true);
  });
  $('#btnTheme').addEventListener('click', () => {
    const order = ['dark', 'dracula', 'nord', 'tokyo-night', 'light', 'solarized-light', 'auto'];
    settings.theme = order[(order.indexOf(settings.theme) + 1) % order.length];
    saveSettings(); applyAppearance();
    toast('主题：' + (THEME_NAMES[settings.theme] || obsThemeLabel(settings.theme) || settings.theme));
  });
  $('#btnSettings').addEventListener('click', openSettings);

  // 标题重命名
  const titleEl = $('#docTitle');
  titleEl.addEventListener('dblclick', () => {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.execCommand('selectAll', false, null);
  });
  titleEl.addEventListener('blur', async () => {
    titleEl.contentEditable = 'false';
    const v = titleEl.textContent.trim() || '未命名.md';
    setTitle(/\.\w+$/.test(v) ? v : v + '.md');
    await checkpoint();
    renderFiles();
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
  });

  // 侧栏
  $('.side-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    app.sideTab = b.dataset.tab;
    $$('.side-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('#panelOutline').classList.toggle('hidden', app.sideTab !== 'outline');
    $('#panelFiles').classList.toggle('hidden', app.sideTab !== 'files');
  });
  $('#panelOutline').addEventListener('click', (e) => {
    const b = e.target.closest('.outline-item');
    if (!b) return;
    const it = outline[Number(b.dataset.idx)];
    if (!it) return;
    app.view.dispatch({
      selection: EditorSelection.cursor(it.pos),
      effects: EditorView.scrollIntoView(it.pos, { y: 'start', yMargin: 60 })
    });
    app.view.focus();
  });
  $('#panelFiles').addEventListener('click', async (e) => {
    const del = e.target.closest('button[data-del]');
    if (del) {
      e.stopPropagation();
      if (window.confirm('删除这个本地暂存文档？')) {
        const r = await F.deleteDoc(del.dataset.del);
        if (!r.ok) { toast('删除失败：' + (r.error && r.error.message || '本地文档库不可用')); return; }
        if (del.dataset.del === app.docId) { app.docId = uid(); app.checkpointText = ''; }
        renderFiles();
      }
      return;
    }
    // 文件夹树
    if (e.target.closest('.tree-open')) { openFolderTree(); return; }
    const tdir = e.target.closest('.tree-dir');
    if (tdir) { toggleDir(tdir.dataset.toggle); return; }
    const tfile = e.target.closest('.tree-file');
    if (tfile) {
      const node = treeState.map.get(tfile.dataset.open);
      if (!node) return;
      if (!(await confirmDiscard())) return;
      try {
        const r = await FT.readFile(node.handle);
        await loadContent(r.name, r.text, r.handle);
        toast(`已打开 ${r.name}`);
      } catch (err) {
        toast('打开失败：' + (err.message || err));
      }
      return;
    }
    const tact = e.target.closest('[data-tree]');
    if (tact) { handleTreeAction(tact.dataset.tree); return; }
    const item = e.target.closest('.file-item');
    if (!item) return;
    if (!(await confirmDiscard())) return;
    const d = F.getDoc(item.dataset.id);
    if (!d) return;
    app.docId = d.id;
    app.handle = null;
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
  });
  $('#btnNewLocal').addEventListener('click', newDoc);

  // 状态栏开关
  $('#btnSource').addEventListener('click', () => {
    const cur = app.view.state.field(sourceModeField, false);
    app.view.dispatch({ effects: sourceModeEffect.of(!cur) });
    $('#btnSource').classList.toggle('on', !cur);
    toast(!cur ? '源码模式' : '所见即所得模式');
    app.view.focus();
  });
  $('#btnFocus').addEventListener('click', () => {
    settings.focusMode = !settings.focusMode; saveSettings(); applyAppearance();
  });
  $('#btnTypewriter').addEventListener('click', () => {
    settings.typewriter = !settings.typewriter; saveSettings(); applyAppearance();
  });

  // Obsidian 主题导入
  $('#btnImportTheme').addEventListener('click', () => $('#importThemeFile').click());
  $('#importThemeFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const name = await importObsidianTheme(file);
      toast(`已导入主题「${name}」，在主题下拉框切换`);
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : err));
    }
    e.target.value = '';
  });
  $('#obsThemeList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-obs]');
    if (!btn) return;
    const t = obsidianThemes[Number(btn.dataset.delObs)];
    if (!t) return;
    obsidianThemes.splice(Number(btn.dataset.delObs), 1);
    saveObsidianThemes();
    injectObsidianCss();
    refreshThemeSelect();
    renderObsidianList();
    if (settings.theme === t.key || settings.theme === t.key + '-light') {
      settings.theme = 'dark'; saveSettings(); applyAppearance();
    }
    toast(`已删除主题「${t.name}」`);
  });

  // 设置面板
  $('#overlay').addEventListener('click', closeSettings);
  $('#btnCloseSettings').addEventListener('click', closeSettings);
  $('#setTheme').addEventListener('change', (e) => { settings.theme = e.target.value; saveSettings(); applyAppearance(); });
  $('#setFont').addEventListener('change', (e) => { settings.fontKind = e.target.value; saveSettings(); applyAppearance(); });
  $('#setSize').addEventListener('input', (e) => {
    settings.fontSize = Number(e.target.value); $('#setSizeVal').textContent = settings.fontSize + 'px';
    saveSettings(); applyAppearance();
  });
  $('#setLh').addEventListener('input', (e) => {
    settings.lineHeight = Number(e.target.value); $('#setLhVal').textContent = settings.lineHeight;
    saveSettings(); applyAppearance();
  });
  $('#setWidth').addEventListener('input', (e) => {
    settings.pageWidth = Number(e.target.value); $('#setWidthVal').textContent = settings.pageWidth + 'px';
    saveSettings(); applyAppearance();
  });
  $('#setJustify').addEventListener('change', (e) => { settings.justify = e.target.checked; saveSettings(); applyAppearance(); });
  $('#setCss').addEventListener('input', debounce((e) => { settings.customCss = e.target.value; saveSettings(); applyAppearance(); }, 250));
  $('#btnPangu').addEventListener('click', () => {
    const before = text();
    const after = panguSpacing(before);
    if (after === before) { toast('已经是规范的中英混排'); return; }
    app.view.dispatch({ changes: { from: 0, to: app.view.state.doc.length, insert: after } });
    toast('已为中英文之间补齐空格');
  });
  $('#btnResetSettings').addEventListener('click', () => {
    settings = Object.assign({}, defaults);
    saveSettings(); applyAppearance(); openSettings();
    toast('已恢复默认外观');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('[data-menu-btn]')) closeMenus();
  });

  // 全局快捷键
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveDoc(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openDoc(); }
    else if (k === 'n' && e.altKey) { e.preventDefault(); newDoc(); }
    else if (k === '\\') { e.preventDefault(); settings.sidebar = !settings.sidebar; saveSettings(); applyAppearance(); }
    else if (k === 'p' && e.shiftKey) { e.preventDefault(); exportPdf(); }
    else if (k === '/') { e.preventDefault(); $('#btnSource').click(); }
  });

  // 拖拽打开
  const wrap = $('.editor-wrap');
  let dragDepth = 0;
  wrap.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    dragDepth++;
    $('#dropHint').classList.remove('hidden');
  });
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').classList.add('hidden'); }
  });
  wrap.addEventListener('drop', async (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    dragDepth = 0;
    $('#dropHint').classList.add('hidden');
    const file = files[0];
    if (/\.(md|markdown|mdown|mkd|txt)$/i.test(file.name)) {
      if (!(await confirmDiscard())) return;
      const r = await F.readDroppedFile(file);
      await loadContent(r.name, r.text, null);
      toast(`已打开 ${r.name}`);
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => C.insertImage(app.view, String(reader.result), file.name);
      reader.readAsDataURL(file);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (app.dirty || checkpointNeedsAttention()) { e.preventDefault(); e.returnValue = ''; }
  });
}

const WELCOME = `# 欢迎使用 InkFlow

一个**所见即所得**的 Markdown 编辑器 —— 输入即渲染，*不需要*切换预览。

把光标移到任意一行，就会看到该行的 Markdown 源码；移开后立刻变回排版效果。

## 常用语法一览

- 无序列表项，支持 ~~删除线~~ 与 ==高亮==
- 行内代码：\`const answer = 42\`
- [超链接](https://commonmark.org)（Ctrl / ⌘ + 单击可打开）

1. 有序列表
2. 第二项

- [x] 任务已完成（点击方框可切换）
- [ ] 待办事项

> 引用块：中英文混排时，InkFlow 会自动优化字距与行高，让 English words 与中文并排也整齐。

### 代码块

\`\`\`python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

### 表格

| 功能 | 快捷键 | 说明 |
| --- | :---: | --- |
| 加粗 | Ctrl+B | 选中文字后按下 |
| 保存 | Ctrl+S | 保存到本地文件 |
| 导出 PDF | Ctrl+Shift+P | 调起系统打印 |

### 数学公式

行内公式 $E = mc^2$ 与块级公式：

$$
\\int_{-\\infty}^{+\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

---

开始你的写作吧。右下角可切换**专注模式**与**打字机模式**。
`;

boot();
