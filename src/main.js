// InkFlow —— 对标 Typora 的所见即所得 Markdown 编辑器
import './styles.css';
import 'katex/dist/katex.min.css';
import { EditorView } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditor, setDoc, readOnlyComp } from './editor.js';
import { sourceModeEffect, sourceModeField, readModeEffect, readModeField } from './livepreview.js';
import { loadMermaid, renderMermaid } from './mermaid.js';
import * as C from './commands.js';
import * as F from './files.js';
import * as FT from './filetree.js';
import { desktopOnBeforeClose, desktopCloseReady, desktopRendererReady, desktopOnOpenFile } from './desktop.js';
import { buildStandaloneHtml, buildStandaloneHtmlAsync, renderMarkdown, renderMarkdownAsync } from './exporter.js';
import { loadTurndown } from './turndown-loader.js';
import { showWelcome, dismissWelcome } from './welcome.js';
import { settings, resetSettings, saveSettings, app, treeState, readRecents } from './state.js';
import { $, $$, ICON } from './icons.js';
import { renderFiles, refreshVaultSection, refreshHistorySection, buildOutline, scheduleOutline, highlightOutline, getOutline, loadTreeFromRoot, indexTree } from './sidebar.js';
import { toast, showConfirm, showPrompt, dismissPrompt } from './dialogs.js';
import { THEME_NAMES, loadObsidianThemes, injectObsidianCss, refreshThemeSelect, renderObsidianList, importObsidianTheme, obsThemeLabel, applyAppearance, deleteObsidianTheme } from './theme.js';
import { text, markDirty, setTitle, renderSaveState, checkpointNeedsAttention, checkpoint, autosave, finishSessionBeforeClose } from './save-pipeline.js';
import { confirmDiscard, newDoc, openDoc, openDocFromPath, loadContent, openVaultDoc, saveDoc, restoreHistory, recordRecentFile, reopenRecent, removeRecent, exportHtml, exportPdf, exportMd, copyAsHtml } from './doc-lifecycle.js';
import { debounce, countWords, panguSpacing, uid, escapeAttr, pathBase } from './utils.js';

/* ---------------- 全局状态 ---------------- */
/* app / treeState / settings 定义见 state.js（全局状态唯一归属地） */
/* indexTree / loadTreeFromRoot 见 sidebar.js（树状态维护与侧栏渲染层） */

/* ---------------- 主题与外观 ---------------- */
/* effectiveTheme / THEME_NAMES / themeFamily / Obsidian 导入 / applyAppearance 见 theme.js */

/* ---------------- 文档状态 ---------------- */
/* text / markDirty / setTitle / renderSaveState / checkpoint / autosave / finishSessionBeforeClose
   见 save-pipeline.js（文档身份与保存管线） */

/* ---------------- 大纲 ---------------- */
/* buildOutline / scheduleOutline / highlightOutline / getOutline 见 sidebar.js（侧栏渲染层） */

/* ---------------- 文档库 ---------------- */
/* renderFiles / refreshVaultSection / refreshHistorySection 及各分区 HTML 见 sidebar.js（侧栏渲染层） */
/* restoreHistory（历史快照恢复）见 doc-lifecycle.js（文档生命周期动作） */

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
  let h;
  try {
    h = await FT.openFolder();
  } catch (e) {
    if (e && e.name === 'AbortError') return; // 用户取消选择器
    toast('打开文件夹失败：' + (e && e.message ? e.message : e), { type: 'error', duration: 7000 });
    return;
  }
  if (!h) return;
  await loadTreeFromRoot(h);
  renderFiles();
  if (!treeState.nodes.length) {
    toast('文件夹已打开，但没有找到 Markdown/文本文件（或目录不可读）', { type: 'warn', duration: 5000 });
  } else {
    toast(`已打开文件夹 ${FT.rootLabel()}`);
  }
}

async function handleTreeAction(act) {
  if (act === 'new') {
    // Electron 不支持 window.prompt，用应用内输入对话框
    const name = await showPrompt({ title: '新建 Markdown 文件', value: '未命名.md', placeholder: '文件名（缺省扩展名自动补 .md）' });
    if (!name) return;
    const h = await FT.createFile(FT.rootDir(), name);
    if (!h) { toast('创建失败：文件已存在或名称无效'); return; }
    const r = await FT.readFile(h);
    await loadContent(r.name, r.text, r.handle, r.mtime);
    await loadTreeFromRoot(FT.rootDir()); // 新文件立即出现在树中，而不是等手动刷新
    renderFiles();
    toast(`已创建 ${r.name}`);
  } else if (act === 'refresh') {
    await loadTreeFromRoot(FT.rootDir());
    renderFiles();
    toast(treeState.nodes.length ? '已刷新' : '刷新完成：文件夹为空或不可读', { type: treeState.nodes.length ? 'info' : 'warn', duration: 3000 });
  } else if (act === 'close') {
    await FT.closeRoot();
    treeState.nodes = [];
    treeState.map.clear();
    treeState.expanded.clear();
    treeState.filter = '';
    renderFiles();
    toast('已关闭文件夹');
  }
}

/* ---------------- 文件操作 ---------------- */
/* confirmDiscard / newDoc / openDoc / openDocFromPath / loadContent / openVaultDoc / saveDoc /
   restoreHistory / recordRecentFile / reopenRecent / removeRecent / 各导出 见 doc-lifecycle.js */

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
    ['table', ICON.table, '表格  Ctrl+Alt+T'],
    ['codeblock', ICON.codeblock, '代码块  Ctrl+Shift+K'],
    ['math', `<span style="font:600 14px var(--font-serif)">Σ</span>`, '行内公式  Ctrl+Shift+M'],
    ['mathblock', `<span style="font:600 12px var(--font-serif)">Σ²</span>`, '公式块  Ctrl+Alt+M'],
    ['hr', ICON.hr, '分隔线  Ctrl+Shift+-'],
    ['|'],
    ['search', ICON.search, '查找替换  Ctrl+F'],
    ['read', ICON.book, '阅读模式（只读）  Ctrl+Alt+R']
  ];
  tb.innerHTML = items.map(([act, icon, title]) =>
    act === '|' ? '<div class="divider"></div>'
      // heading 按钮会弹出菜单，需带 data-menu-btn，否则 document 的点击关闭监听会把菜单立即关掉
      : `<button class="icon-btn" data-act="${act}"${act === 'heading' ? ' data-menu-btn' : ''} title="${title}">${icon}</button>`
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
  $('#setSpell').checked = !!settings.spellcheck;
  $('#setWelcome').checked = settings.welcome !== false;
  $('#setAutosave').value = settings.autosaveMs;
  $('#setAutosaveVal').textContent = settings.autosaveMs + 'ms';
  $('#setCss').value = settings.customCss || '';
  $('#overlay').classList.remove('hidden');
  $('#settingsDlg').classList.remove('hidden');
}
function closeSettings() {
  $('#overlay').classList.add('hidden');
  $('#settingsDlg').classList.add('hidden');
}

/* ---------------- 启动 ---------------- */
const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
  reader.readAsDataURL(file);
});

/** 粘贴/拖入的图片：优先落盘（桌面版文档旁或文件夹树根的 assets/，文件名去重），失败回退 base64 内联 */
async function insertImageFile(view, file) {
  const fileName = file.name || 'image.png';
  let src = null;
  try {
    const treeRoot = FT.rootDir();
    if (F.isDesktop) {
      const docDir = app.handle && app.handle.path
        ? app.handle.path.slice(0, Math.max(app.handle.path.lastIndexOf('\\'), app.handle.path.lastIndexOf('/')))
        : '';
      const dir = docDir || (treeRoot && treeRoot.path) || '';
      if (dir) src = await F.writeAssetDesktop(dir, fileName, await readAsDataURL(file));
    } else if (FT.hasRoot() && treeRoot) {
      // 文档在树中的相对深度决定 ../ 前缀（app.path 是以 / 分隔的树内合成路径）
      const depth = app.path ? app.path.split('/').length - 1 : 0;
      const name = await F.writeAssetBrowser(treeRoot, fileName, file);
      if (name) src = '../'.repeat(depth) + 'assets/' + name;
    }
  } catch (e) { /* 落盘失败回退 base64 */ }
  if (!src) {
    try { src = await readAsDataURL(file); } catch (e) { src = ''; }
    if (!src) { toast('图片读取失败', { type: 'error', duration: 7000 }); return; }
  }
  const r = view.state.selection.main;
  const md = `![${fileName.replace(/\.[a-z0-9]+$/i, '') || '图片'}](${src})`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: md }, selection: { anchor: r.from + md.length }, scrollIntoView: true });
  if (!src.startsWith('data:')) toast(`图片已保存到 ${src}`);
}

/** 富文本 HTML → Markdown 后插入（Turndown 懒加载；转换失败退回纯文本） */
async function insertHtmlAsMarkdown(view, html, plain) {
  let md;
  try {
    const svc = await loadTurndown();
    md = svc.turndown(html).trim();
  } catch (e) {
    md = plain || html;
  }
  if (!md) return;
  const r = view.state.selection.main;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: md },
    selection: { anchor: r.from + md.length },
    scrollIntoView: true,
    userEvent: 'input.paste'
  });
}

async function boot() {
  buildToolbar();

  const pasteHandler = EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return true; // 阅读模式：忽略粘贴
      const cd = event.clipboardData;
      const items = cd && cd.items;
      if (!items) return false;
      // 1) 图片：优先落盘为文件（assets/），失败回退 base64
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (!file) continue;
          event.preventDefault();
          insertImageFile(view, file);
          return true;
        }
      }
      // 2) 富文本 HTML → Markdown（从网页/Word/Excel 复制的内容）
      const html = cd.getData('text/html');
      if (html) {
        event.preventDefault();
        insertHtmlAsMarkdown(view, html, cd.getData('text/plain'));
        return true;
      }
      return false;
    }
  });

  app.view = createEditor({
    parent: $('#editor'),
    doc: '',
    extra: [pasteHandler],
    onChange: (u) => {
      const doc = u.state.doc;
      // 长度不同必然脏；等长时才需要序列化比较，避免每次按键都物化整个文档字符串
      markDirty(doc.length !== app.savedText.length || doc.toString() !== app.savedText);
      scheduleOutline();
      updateStatusPos();
      scheduleStatusCounts();
      autosave();
    },
    onSelection: () => {
      updateStatusPos();
      highlightOutline();
      if (settings.typewriter) {
        requestAnimationFrame(() => {
          const head = app.view.state.selection.main.head;
          app.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
        });
      }
    }
  });

  // 临时备份不跨会话保留：启动时清理异常退出遗留的内容。
  const vault = await F.initVault();
  if (!vault.ok) {
    app.vaultError = true;
    renderSaveState();
    toast('临时备份不可用，请及时保存或导出备份');
  }
  if (vault.ok) await F.clearDocs();
  app.docId = uid();
  app.handle = null;
  app.path = '';
  app.mtime = null;
  setTitle('欢迎.md', '');
  setDoc(app.view, WELCOME);
  app.savedText = WELCOME;
  app.checkpointText = '';
  if (vault.ok) await checkpoint({ notifyFailure: false });
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
  // 启动欢迎页：全屏烟花 + 品牌语，点击/任意键进入（设置里可关）。
  // 自动化测试（webdriver）下跳过，避免遮挡测试点击
  if (settings.welcome !== false && !navigator.webdriver) showWelcome({ onEnter: () => app.view.focus() });
  if (F.isDesktop) {
    desktopOnBeforeClose(async () => {
      if (app.dirty || checkpointNeedsAttention()) {
        const choice = await showConfirm({
          title: '文档尚未保存',
          message: app.handle
            ? '当前文档有尚未保存的改动，关闭前怎么处理？'
            : '当前文档尚未保存到文件，关闭前怎么处理？',
          actions: [
            { label: app.handle ? '保存并关闭' : '另存为并关闭', value: 'save', kind: 'primary' },
            { label: '不保存关闭', value: 'discard', kind: 'ghost' },
            { label: '取消', value: 'cancel', kind: 'ghost' }
          ]
        });
        if (choice === 'cancel') return;                 // 取消：保持窗口
        if (choice === 'save') {
          if (await finishSessionBeforeClose()) desktopCloseReady();
          return;
        }
        // 不保存关闭：不落盘，清理临时备份后关闭
        const cleared = await F.clearDocs();
        if (cleared.ok) { app.forceClose = true; desktopCloseReady(); }
        else toast('清理临时备份失败，已保留数据，请手动关闭', { type: 'error', duration: 7000 });
        return;
      }
      if (await finishSessionBeforeClose()) desktopCloseReady();
    });
    // 订阅外部打开请求（启动参数/二次启动），随后上报就绪触发主进程下发
    desktopOnOpenFile(openDocFromPath);
    desktopRendererReady();
  }
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
    renderMermaid, loadMermaid, finishSessionBeforeClose, loadContent,
    setReadMode, toggleReadMode, isReadMode,
    showWelcome, dismissWelcome
  };
}

let statusCountsTimer = null;
function updateStatusPos() {
  const state = app.view.state;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  $('#stPos').textContent = `行 ${line.number} : 列 ${head - line.from + 1}`;
}
function updateStatusCounts() {
  const t = app.view.state.doc.toString();
  const { words, chars } = countWords(t);
  $('#stWords').textContent = `${words} 词`;
  $('#stChars').textContent = `${chars} 字符`;
  $('#stRead').textContent = `约 ${Math.max(1, Math.round(words / 300))} 分钟`;
}
// 全文字数统计是 O(n)，打字期间防抖刷新；行号/列号开销极小，随选区即时更新
function scheduleStatusCounts() {
  clearTimeout(statusCountsTimer);
  statusCountsTimer = setTimeout(updateStatusCounts, 250);
}
function updateStatus() { updateStatusPos(); updateStatusCounts(); }

/* ---------------- 阅读模式 / 编辑模式 ---------------- */
// 阅读模式：内容只读、点击不显示源码、隐藏光标；编辑模式恢复正常编辑
let readMode = false;
function isReadMode() { return readMode; }

function setReadMode(on) {
  readMode = on;
  if (!app.view) return;
  app.view.dispatch({ effects: [
    readModeEffect.of(on),
    readOnlyComp.reconfigure(on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [])
  ] });
  // 阅读模式与源码模式互斥：进入阅读模式时退出源码模式，反之亦然
  if (on && app.view.state.field(sourceModeField, false)) {
    app.view.dispatch({ effects: sourceModeEffect.of(false) });
    $('#btnSource').classList.remove('on');
  }
  $('#app').classList.toggle('read-mode', on);
  $('#toolbar').classList.toggle('readonly', on);
  $('#btnSource').disabled = on;
  const btn = $('#btnRead');
  if (btn) {
    btn.textContent = on ? '阅读' : '编辑';
    btn.classList.toggle('on', on);
  }
  toast(on ? '阅读模式：内容只读，点击不显示源码' : '编辑模式：已恢复编辑');
  app.view.focus();
}
function toggleReadMode() { setReadMode(!readMode); }

/* ---------------- 快速打开（Ctrl+P） ---------------- */
// 模糊匹配：子串命中优先（越靠前越好），否则按子序列连续度打分
function fuzzyScore(text, q) {
  if (!q) return 1;
  const t = String(text).toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 2000 - idx - t.length * 0.05;
  let score = 100, last = -2;
  for (const ch of q) {
    const j = t.indexOf(ch, last + 1);
    if (j < 0) return -1;
    if (j === last + 1) score += 3; // 连续命中加分
    last = j;
  }
  return score - t.length * 0.05;
}

// 候选来源：文件树（含已加载子目录）+ 最近文件（桌面版）+ 本次会话暂存
function quickOpenSources() {
  const out = [];
  const walk = (nodes, prefix) => {
    for (const n of nodes) {
      if (n.kind === 'dir') walk(n.children || [], prefix ? `${prefix}/${n.name}` : n.name);
      else out.push({ type: 'tree', name: n.name, sub: prefix || '', node: n });
    }
  };
  walk(treeState.nodes, '');
  if (F.isDesktop) {
    for (const r of readRecents()) out.push({ type: 'recent', name: r.name, sub: pathBase(r.path), recent: r });
  }
  for (const d of F.listDocs()) out.push({ type: 'vault', name: d.name, sub: '本次会话', doc: d });
  return out;
}

let qoList = [];
let qoSel = 0;
function renderQuickOpen() {
  const q = $('#qoInput').value.trim().toLowerCase();
  qoList = quickOpenSources().map((it) => ({
    ...it,
    score: Math.max(fuzzyScore(it.name, q), (it.sub ? fuzzyScore(it.sub, q) : -1) * 0.9)
  })).filter((it) => it.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
  qoSel = 0;
  const typeLabel = { tree: '文件夹', recent: '最近', vault: '暂存' };
  $('#qoList').innerHTML = qoList.length
    ? qoList.map((it, i) =>
        `<button class="qo-item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="qo-type">${typeLabel[it.type]}</span>${escapeAttr(it.name)}<span class="qo-path">${escapeAttr(it.sub)}</span></button>`
      ).join('')
    : '<div class="empty-tip">没有匹配的文件</div>';
}
function setQoSel(i) {
  qoSel = i;
  $$('#qoList .qo-item').forEach((el, j) => el.classList.toggle('active', j === i));
  const el = $('#qoList .qo-item.active');
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function openQuickOpen() {
  $('#qoOverlay').classList.remove('hidden');
  $('#quickOpen').classList.remove('hidden');
  $('#qoInput').value = '';
  renderQuickOpen();
  $('#qoInput').focus();
}
function closeQuickOpen() {
  $('#qoOverlay').classList.add('hidden');
  $('#quickOpen').classList.add('hidden');
}
async function openQuickOpenItem(i) {
  const it = qoList[i];
  closeQuickOpen();
  if (!it) return;
  try {
    if (it.type === 'tree') {
      if (!(await confirmDiscard())) return;
      const r = await FT.readFile(it.node.handle);
      await loadContent(r.name, r.text, it.node.handle, r.mtime || null);
      toast(`已打开 ${r.name}`);
    } else if (it.type === 'recent') {
      const idx = readRecents().findIndex((r) => r.path === it.recent.path);
      if (idx >= 0) await reopenRecent(idx);
    } else if (it.type === 'vault') {
      await openVaultDoc(it.doc);
    }
  } catch (e) {
    toast('打开失败：' + (e.message || e), { type: 'error', duration: 7000 });
  }
}

/* ---------------- 文件夹全文搜索 ---------------- */
const searchState = { query: '', results: [], searching: false };
function highlightSnippet(text, q) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return escapeAttr(text);
  return escapeAttr(text.slice(0, idx)) + '<mark>' + escapeAttr(text.slice(idx, idx + q.length)) + '</mark>' + escapeAttr(text.slice(idx + q.length));
}
function searchResultsHtml() {
  if (!FT.hasRoot()) return '<div class="empty-tip">先在「文档」页打开文件夹，<br>才能搜索其中内容。</div>';
  if (!searchState.results.length) return searchState.query ? '<div class="empty-tip">没有匹配的内容</div>' : '';
  return searchState.results.map((r, i) =>
    `<button class="search-item" data-i="${i}" title="${escapeAttr(r.file.path + ' 第 ' + r.line + ' 行')}"><span class="search-file">${escapeAttr(r.file.path)}</span><span class="search-line">${highlightSnippet(r.text, searchState.query)}</span></button>`
  ).join('');
}
function renderSearchPanel() {
  const el = $('#panelSearch');
  el.innerHTML = `
    <div style="padding:0 10px 6px">
      <input type="text" id="searchInput" placeholder="在文件夹中搜索全文…" value="${escapeAttr(searchState.query)}"
        style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;outline:none">
      <div id="searchMeta" style="font-size:11px;color:var(--text-faint);margin-top:4px">${searchState.searching ? '搜索中…' : (searchState.results.length ? `${searchState.results.length} 条匹配` : '')}</div>
    </div>
    <div class="tree" id="searchResults">${searchResultsHtml()}</div>`;
}
async function runSearch() {
  if (!searchState.query || !FT.hasRoot()) {
    searchState.results = [];
    searchState.searching = false;
    const list = $('#searchResults');
    const meta = $('#searchMeta');
    if (list) list.innerHTML = searchResultsHtml();
    if (meta) meta.textContent = '';
    return;
  }
  searchState.searching = true;
  const meta = $('#searchMeta');
  if (meta) meta.textContent = '搜索中…';
  try {
    searchState.results = await FT.searchFolder(searchState.query);
  } catch (e) {
    searchState.results = [];
  }
  searchState.searching = false;
  const list = $('#searchResults');
  const meta2 = $('#searchMeta');
  if (list) list.innerHTML = searchResultsHtml();
  if (meta2) meta2.textContent = `${searchState.results.length} 条匹配`;
}

function wireEvents() {
  // 工具栏
  $('#toolbar').addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'heading') { toggleMenu('#headingMenu', btn); return; }
    if (act === 'read') { toggleReadMode(); return; }
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
    if (b.dataset.exp === 'copyhtml') copyAsHtml();
    if (b.dataset.exp === 'pdf') exportPdf();
    if (b.dataset.exp === 'saveas') saveDoc(true);
  });
  $('#btnTheme').addEventListener('click', () => {
    const order = ['dark', 'dracula', 'nord', 'tokyo-night', 'ink-wash', 'carbon-lilac', 'paper-saffron', 'light', 'solarized-light', 'auto'];
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
    setTitle(/\.\w+$/.test(v) ? v : v + '.md', app.path);
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
    $('#panelSearch').classList.toggle('hidden', app.sideTab !== 'search');
    if (app.sideTab === 'files') { refreshVaultSection(); refreshHistorySection(); } // 隐藏期间被跳过的更新在此补上
    if (app.sideTab === 'search') renderSearchPanel(); // 首次切换时渲染搜索框
  });
  $('#panelOutline').addEventListener('click', (e) => {
    const b = e.target.closest('.outline-item');
    if (!b) return;
    const it = getOutline()[Number(b.dataset.idx)];
    if (!it) return;
    app.view.dispatch({
      selection: EditorSelection.cursor(it.pos),
      effects: EditorView.scrollIntoView(it.pos, { y: 'start', yMargin: 60 })
    });
    app.view.focus();
  });
  // 文件树搜索（input 事件委托；防抖重建后恢复焦点与光标，大目录下避免每键全量重建面板）。
  // 只注册一次，不能放进下方 click 处理器内——那会随每次点击重复注册
  const scheduleTreeSearch = debounce(() => {
    renderFiles();
    const inp = $('#treeSearch');
    if (inp) {
      inp.focus();
      const end = inp.value.length;
      inp.setSelectionRange(end, end);
    }
  }, 120);
  $('#panelFiles').addEventListener('input', (e) => {
    if (e.target.id !== 'treeSearch') return;
    treeState.filter = e.target.value.trim();
    scheduleTreeSearch();
  });
  $('#panelFiles').addEventListener('click', async (e) => {
    const hdel = e.target.closest('[data-hdel]');
    if (hdel) {
      e.stopPropagation();
      if (await showConfirm({
        title: '删除历史快照',
        message: '删除后将无法恢复这份快照。',
        actions: [
          { label: '删除', value: 'delete', kind: 'primary' },
          { label: '取消', value: 'cancel', kind: 'ghost' }
        ]
      }) === 'delete') {
        const r = await F.deleteHistory(hdel.dataset.hdel);
        if (r.ok) refreshHistorySection();
        else toast('删除失败：本地文档库不可用', { type: 'error', duration: 7000 });
      }
      return;
    }
    const hist = e.target.closest('[data-history]');
    if (hist) { await restoreHistory(hist.dataset.history); return; }
    const recentDel = e.target.closest('[data-recent-del]');
    if (recentDel) {
      e.stopPropagation();
      await removeRecent(Number(recentDel.dataset.recentDel));
      return;
    }
    const recent = e.target.closest('[data-recent]');
    if (recent) {
      if (e.target.closest('.fi-del')) return; // 由 recentDel 分支处理
      await reopenRecent(Number(recent.dataset.recent));
      return;
    }
    const del = e.target.closest('button[data-del]');
    if (del) {
      e.stopPropagation();
      if (await showConfirm({
        title: '删除本地暂存',
        message: '删除后将无法从本地暂存中恢复这份文档。',
        actions: [
          { label: '删除', value: 'delete', kind: 'primary' },
          { label: '取消', value: 'cancel', kind: 'ghost' }
        ]
      }) === 'delete') {
        const r = await F.deleteDoc(del.dataset.del);
        if (!r.ok) { toast('删除失败：' + (r.error && r.error.message || '本地文档库不可用')); return; }
        if (del.dataset.del === app.docId) { app.docId = uid(); app.checkpointText = ''; }
        renderFiles();
      }
      return;
    }
    // 文件树搜索监听已在上方注册，这里只处理点击路由
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
        await loadContent(r.name, r.text, r.handle, r.mtime || null);
        toast(`已打开 ${r.name}`);
      } catch (err) {
        toast('打开失败：' + (err.message || err), { type: 'error', duration: 7000 });
      }
      return;
    }
    const tact = e.target.closest('[data-tree]');
    if (tact) { handleTreeAction(tact.dataset.tree); return; }
    const item = e.target.closest('.file-item');
    if (!item) return;
    const d = F.getDoc(item.dataset.id);
    if (!d) return;
    await openVaultDoc(d);
  });
  $('#btnNewLocal').addEventListener('click', newDoc);

  // 状态栏开关
  $('#btnRead').addEventListener('click', () => {
    toggleReadMode();
    app.view.focus();
  });
  $('#btnSource').addEventListener('click', () => {
    if (readMode) { toast('阅读模式下不可查看源码，请先退出'); return; }
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
    const t = deleteObsidianTheme(Number(btn.dataset.delObs));
    if (!t) return;
    if (settings.theme === t.key || settings.theme === t.key + '-light') {
      settings.theme = 'dark'; saveSettings(); applyAppearance();
    }
    toast(`已删除主题「${t.name}」`);
  });

  // 设置面板
  $('#overlay').addEventListener('click', closeSettings);
  $('#btnCloseSettings').addEventListener('click', closeSettings);
  // 输入对话框（Electron 无 window.prompt 的替代）
  $('#promptOk').addEventListener('click', () => dismissPrompt($('#promptInput').value.trim() || null));
  $('#promptCancel').addEventListener('click', () => dismissPrompt(null));
  $('#promptOverlay').addEventListener('click', () => dismissPrompt(null));
  $('#promptInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dismissPrompt($('#promptInput').value.trim() || null); }
  });
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
  $('#setSpell').addEventListener('change', (e) => { settings.spellcheck = e.target.checked; saveSettings(); applyAppearance(); });
  $('#setWelcome').addEventListener('change', (e) => { settings.welcome = e.target.checked; saveSettings(); });
  $('#setAutosave').addEventListener('input', (e) => {
    settings.autosaveMs = Number(e.target.value);
    $('#setAutosaveVal').textContent = settings.autosaveMs + 'ms';
    saveSettings();
  });
  $('#setCss').addEventListener('input', debounce((e) => { settings.customCss = e.target.value; saveSettings(); applyAppearance(); }, 250));
  $('#btnPangu').addEventListener('click', () => {
    if (readMode) { toast('阅读模式下不可编辑'); return; }
    const before = text();
    const after = panguSpacing(before);
    if (after === before) { toast('已经是规范的中英混排'); return; }
    app.view.dispatch({ changes: { from: 0, to: app.view.state.doc.length, insert: after } });
    toast('已为中英文之间补齐空格');
  });
  $('#btnResetSettings').addEventListener('click', () => {
    resetSettings();
    saveSettings(); applyAppearance(); openSettings();
    toast('已恢复默认外观');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('[data-menu-btn]')) closeMenus();
  });

  // 快速打开（Ctrl+P）
  $('#qoInput').addEventListener('input', renderQuickOpen);
  $('#qoInput').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setQoSel(Math.min(qoSel + 1, qoList.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setQoSel(Math.max(qoSel - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); openQuickOpenItem(qoSel); }
    else if (e.key === 'Escape') { e.preventDefault(); closeQuickOpen(); }
  });
  $('#qoList').addEventListener('click', (e) => {
    const b = e.target.closest('.qo-item');
    if (b) openQuickOpenItem(Number(b.dataset.i));
  });
  $('#qoOverlay').addEventListener('click', closeQuickOpen);

  // 全文搜索：输入防抖后执行，完成后只更新结果区（保住输入框焦点）
  const scheduleSearch = debounce(runSearch, 300);
  $('#panelSearch').addEventListener('input', (e) => {
    if (e.target.id !== 'searchInput') return;
    searchState.query = e.target.value.trim();
    scheduleSearch();
  });
  $('#panelSearch').addEventListener('click', async (e) => {
    const b = e.target.closest('.search-item');
    if (!b) return;
    const r = searchState.results[Number(b.dataset.i)];
    if (!r) return;
    if (!(await confirmDiscard())) return;
    try {
      const rd = await FT.readFile(r.file.handle);
      await loadContent(rd.name, rd.text, r.file.handle, rd.mtime || null);
      const doc = app.view.state.doc;
      if (r.line <= doc.lines) {
        const pos = doc.line(r.line).from;
        app.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      }
      app.view.focus();
      toast(`已打开 ${rd.name}`);
    } catch (err) {
      toast('打开失败：' + (err.message || err), { type: 'error', duration: 7000 });
    }
  });

  // 全局快捷键
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveDoc(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openDoc(); }
    else if (k === 'n' && e.altKey) { e.preventDefault(); newDoc(); }
    else if (k === 'p' && !e.shiftKey) { e.preventDefault(); openQuickOpen(); } // Ctrl+Shift+P 仍是导出 PDF
    else if (k === '\\') { e.preventDefault(); settings.sidebar = !settings.sidebar; saveSettings(); applyAppearance(); }
    else if (k === 'p' && e.shiftKey) { e.preventDefault(); exportPdf(); }
    else if (k === '/' && !readMode) { e.preventDefault(); $('#btnSource').click(); }
    else if (k === 'r' && e.altKey) { e.preventDefault(); toggleReadMode(); }
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
    const list = Array.from(files);
    const docs = list.filter((f) => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name));
    const images = list.filter((f) => f.type.startsWith('image/'));

    // 多个 Markdown：打开第一个；拖入的 File 对象拿不到绝对路径，无法逐个打开，提示走文件夹树
    if (docs.length) {
      if (!(await confirmDiscard())) return;
      const first = docs[0];
      const r = await F.readDroppedFile(first);
      await loadContent(r.name, r.text, null, null);
      if (docs.length > 1) {
        toast(`已打开 ${r.name}，其余 ${docs.length - 1} 个文件请从文件夹树打开`, { duration: 4000 });
      } else {
        toast(`已打开 ${r.name}`);
      }
      return;
    }
    if (images.length) {
      const file = images[0];
      insertImageFile(app.view, file);
      if (images.length > 1) toast(`已插入第 1 张图片，其余 ${images.length - 1} 张请逐张拖入`);
      return;
    }
    toast('支持的格式：Markdown / 文本文件 / 图片', { type: 'warn', duration: 5000 });
  });

  window.addEventListener('beforeunload', (e) => {
    // 桌面版「不保存关闭」已由用户确认并置 forceClose，放行 close-ready 触发的关闭，
    // 否则这里会因 dirty 仍为 true 而把窗口关掉的动作再次取消（窗口静默留在原地）
    if (app.forceClose) return;
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

开始你的写作吧。右下角可切换**专注模式**与**打字机模式**，点工具栏的书形按钮或按 **Ctrl+Alt+R** 可进入**阅读模式**（只读，防止误改）。
`;

boot();
