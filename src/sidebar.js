// src/sidebar.js —— 侧栏渲染层：大纲、文件树、最近文件、本地文档库、历史版本
// 只负责「根据当前状态渲染 DOM」与树状态的维护；打开/保存/恢复等动作见 doc-lifecycle.js
import * as F from './files.js';
import * as FT from './filetree.js';
import { app, treeState, readRecents } from './state.js';
import { $, $$, ICON } from './icons.js';
import { debounce, fmtTime, escapeAttr, pathBase } from './utils.js';

/* ---------------- 文件夹树状态维护 ---------------- */
export function indexTree(nodes) {
  for (const n of nodes) {
    treeState.map.set(n.path, n);
    if (n.children) indexTree(n.children);
  }
}

export async function loadTreeFromRoot(h) {
  treeState.nodes = (await FT.walkDir(h, 0)).map((c) => ({ ...c, path: c.name }));
  treeState.map.clear();
  indexTree(treeState.nodes);
  treeState.expanded.clear();
  treeState.filter = '';
}

/* ---------------- 大纲 ---------------- */
let outline = [];
export function getOutline() { return outline; }
export function buildOutline() {
  const doc = app.view.state.doc;
  const items = [];
  let fence = null;
  let prevText = ''; // 上一个非空正文行，用于识别 Setext 标题
  for (let i = 1; i <= doc.lines; i++) {
    const t = doc.line(i).text;
    const fm = /^\s{0,3}(```+|~~~+)/.exec(t);
    if (fence) { if (fm && t.trim().startsWith(fence)) { fence = null; prevText = ''; } continue; }
    if (fm) { fence = fm[1]; prevText = ''; continue; }
    // Setext 标题：正文行的下一行是 === (h1) / --- (h2)；前一行是标题或列表、或空行后的 ---（分隔线）不算
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(t);
    const isAtx = /^(#{1,6})\s+/.test(prevText);
    const isList = /^\s*([-*+]|\d+[.)])\s/.test(prevText);
    if (setext && prevText && !isAtx && !isList) {
      const level = setext[1][0] === '=' ? 1 : 2;
      items.push({ level, title: prevText.replace(/[*_`~]/g, '').trim() || '(空标题)', line: i - 1, pos: doc.line(i - 1).from });
      prevText = '';
      continue;
    }
    const m = /^(#{1,6})\s+(.*)$/.exec(t);
    if (m) {
      items.push({ level: m[1].length, title: m[2].replace(/[*_`~]/g, '').trim() || '(空标题)', line: i, pos: doc.line(i).from });
      prevText = '';
      continue;
    }
    prevText = t.trim() ? t : '';
  }
  outline = items;
  const panel = $('#panelOutline');
  const html = items.length
    ? items.map((it, i) =>
        `<button class="outline-item" data-level="${it.level}" data-idx="${i}" title="${escapeAttr(it.title)}">${escapeAttr(it.title)}</button>`
      ).join('')
    : '<div class="empty-tip">还没有标题。<br>用 # 开头写个标题，大纲会自动出现。</div>';
  if (panel._inkHtml !== html) { // 标题未变化时跳过 DOM 重建（打字期间每键都会走到这里）
    panel._inkHtml = html;
    panel.innerHTML = html;
  }
}
// 打字期间大纲扫描是 O(文档行数)，防抖执行
export const scheduleOutline = debounce(buildOutline, 250);
export function highlightOutline() {
  if (!outline.length) return;
  const pos = app.view.state.selection.main.head;
  let idx = -1;
  for (let i = 0; i < outline.length; i++) if (outline[i].pos <= pos) idx = i;
  $$('#panelOutline .outline-item').forEach((el, i) => el.classList.toggle('active', i === idx));
}

/* ---------------- 文档面板渲染 ---------------- */
export function renderFiles() {
  const panel = $('#panelFiles');
  panel.innerHTML = recentSectionHtml() + treeSectionHtml() + `<div id="vaultSection">${vaultSectionHtml()}</div>` + `<div id="historySection">${historySectionHtml()}</div>`;
}

// checkpoint 后只需更新「本次会话」暂存列表——全量 renderFiles 会连带重建文件树，
// 打字期间每 0.7s 重建一次树 DOM 代价过高（且会丢失筛选输入框焦点）
export function refreshVaultSection() {
  const el = $('#vaultSection');
  // 面板不可见（侧栏收起 / 停在大纲页）时跳过 DOM 更新，切回文档页时补一次
  if (!el || !el.offsetParent) return;
  el.innerHTML = vaultSectionHtml();
}

function historySectionHtml() {
  const list = F.listHistory();
  if (!list.length) return '';
  return '<div class="vault-head">历史版本（近 7 天）</div>' + list.map((d) => `
    <div class="file-item" data-history="${escapeAttr(d.id)}" title="点击恢复此快照">
      <div class="fi-main">
        <div class="fi-name">${escapeAttr(d.name)}</div>
        <div class="fi-meta">${fmtTime(d.updated)} · ${d.text.length} 字符</div>
      </div>
      <button class="fi-del" data-hdel="${escapeAttr(d.id)}" title="删除此快照">${ICON.trash}</button>
    </div>`).join('');
}

export function refreshHistorySection() {
  const el = $('#historySection');
  if (!el || !el.offsetParent) return;
  el.innerHTML = historySectionHtml();
}

function treeSectionHtml() {
  if (!FT.hasRoot()) {
    return `<button class="tree-open" title="打开一个文件夹，浏览其中的 Markdown 文件">📂 打开文件夹</button>`;
  }
  const q = treeState.filter || '';
  const nodes = q ? filterTreeNodes(treeState.nodes, q) : treeState.nodes;
  const matched = countTreeFiles(nodes);
  return `
    <div class="tree-toolbar">
      <span class="tree-root" title="当前文件夹：${escapeAttr(FT.rootLabel())}">📁 ${escapeAttr(FT.rootLabel())}</span>
      <button class="tree-act" data-tree="new" title="在文件夹中新建 Markdown 文件">＋</button>
      <button class="tree-act" data-tree="refresh" title="刷新文件夹">⟳</button>
      <button class="tree-act" data-tree="close" title="关闭文件夹">×</button>
    </div>
    <div style="padding:0 10px 6px">
      <input type="text" id="treeSearch" placeholder="搜索文件名…" value="${escapeAttr(q)}"
        style="width:100%;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;outline:none">
      ${q ? `<div style="font-size:11px;color:var(--text-faint);margin-top:4px">匹配 ${matched} 个文件</div>` : ''}
    </div>
    <div class="tree">${matched || !q ? treeNodesHtml(nodes) : '<div class="empty-tip">没有匹配的文件</div>'}</div>`;
}

// 按名称子串过滤树节点：只保留命中文件，及其包含命中后代的已加载目录
function filterTreeNodes(nodes, q) {
  const lower = q.toLowerCase();
  const out = [];
  for (const n of nodes) {
    if (n.kind === 'dir') {
      if (!n.children) continue; // 未加载的懒加载目录无法确认内部命中，跳过
      const kids = filterTreeNodes(n.children, q);
      if (kids.length) out.push({ ...n, children: kids });
    } else if (n.name.toLowerCase().includes(lower)) {
      out.push(n);
    }
  }
  return out;
}
function countTreeFiles(nodes) {
  let c = 0;
  for (const n of nodes) {
    if (n.kind === 'dir') c += countTreeFiles(n.children || []);
    else c++;
  }
  return c;
}

function treeNodesHtml(nodes) {
  const filtering = !!treeState.filter;
  return nodes.map((n) => {
    if (n.kind === 'dir') {
      // 过滤模式下渲染出来的目录必然包含命中文件，直接展开
      const open = filtering || treeState.expanded.has(n.path);
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
    return '<div class="vault-head">本次会话</div><div class="empty-tip">暂无临时备份。<br>关闭应用时会自动清除。</div>';
  }
  return '<div class="vault-head">本次会话</div>' + list.map((d) => `
    <div class="file-item${d.id === app.docId ? ' active' : ''}" data-id="${d.id}">
      <div class="fi-main">
        <div class="fi-name">${escapeAttr(d.name)}</div>
        <div class="fi-meta">${fmtTime(d.updated)} · ${d.text.length} 字符</div>
      </div>
      <button class="fi-del" data-del="${d.id}" title="删除">${ICON.trash}</button>
    </div>`).join('');
}

function recentSectionHtml() {
  const list = readRecents();
  if (!list.length) return '';
  return `<div class="vault-head">最近</div>` + list.map((r, i) => `
    <div class="file-item recent-item" data-recent="${i}" title="${escapeAttr(r.path)}">
      <div class="fi-main">
        <div class="fi-name">${escapeAttr(r.name)}</div>
        <div class="fi-meta">${pathBase(r.path)}</div>
      </div>
      <button class="fi-del" data-recent-del="${i}" title="从最近移除">${ICON.trash}</button>
    </div>`).join('');
}
