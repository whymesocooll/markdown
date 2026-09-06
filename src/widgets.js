// 实时预览用的各类 Widget（数学公式 / 图片 / 表格 / 分隔线 / 任务勾选框 / 列表符号）
import { WidgetType } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import { loadKatex, katexNow } from './katex-loader.js';
import { sanitizeHtml, escapeHtml } from './utils.js';
import { renderInline } from './inline-md.js';
import { insertRow, deleteRow, insertCol, deleteCol, setColAlign, setCell } from './table-edit.js';
import { loadMermaid, mermaidTheme, renderMermaid } from './mermaid.js';

// 异步 widget（公式/KaTeX、mermaid SVG、表格单元格公式）内容就绪后块高会变化，
// 而 CM 的 measure 只在「内容元素总高变化」或「DOM 真正更新」后重读行高——仅 dispatch
// 效果不足以触发重测。因此渲染结果统一缓存并纳入 widget 的 eq 判定：就绪后经
// widgetRelayout 触发装饰重建，新旧 widget 因 eq 不相等而被 CM 替换 DOM，块高随之一并
// 被正确测量（IIFE 单文件构建因渲染恰好在首次测量前完成而掩盖了此问题，ESM 按需加载
// 后必然暴露：点击 widget 下方内容会错位一行）。
export const widgetRelayout = StateEffect.define();
function relayout(view) {
  view.dispatch({ effects: widgetRelayout.of(null) });
}
// 简单 FIFO 缓存：key -> 渲染结果字符串
function cachePut(map, key, val, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  if (map.size > max) map.delete(map.keys().next().value);
}

/** 把光标送回源码位置：点击渲染结果即可编辑 */
function editOnClick(dom, view, pos) {
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  });
}

/* ---------- KaTeX 渲染缓存（tex\0display -> html） ---------- */
const mathCache = new Map();

export class MathWidget extends WidgetType {
  constructor(tex, display, pos) {
    super();
    this.tex = tex;
    this.display = display;
    this.pos = pos;
    this.html = mathCache.get(tex + '\0' + display) || null;
  }
  eq(other) { return other.tex === this.tex && other.display === this.display && other.html === this.html; }
  toDOM(view) {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'ink-math ink-math-block' : 'ink-math ink-math-inline';
    editOnClick(el, view, this.pos);
    if (this.html != null) { // 缓存命中：同步渲染，无占位闪烁
      el.innerHTML = this.html;
      return el;
    }
    const errorText = (this.display ? '$$' : '$') + this.tex + (this.display ? '$$' : '$');
    loadKatex().then((katex) => {
      let html;
      try {
        html = katex.renderToString(this.tex, {
          displayMode: this.display,
          throwOnError: false,
          strict: 'ignore',
          output: 'html',
          trust: false
        });
      } catch (err) {
        el.classList.add('ink-math-error');
        el.textContent = errorText;
        return;
      }
      cachePut(mathCache, this.tex + '\0' + this.display, html, 200);
      if (el.isConnected) el.innerHTML = html;
      relayout(view); // 重建 widget（eq 因 html 就绪而不相等）→ CM 替换 DOM 并重新测量
    }).catch(() => {
      if (!el.isConnected) return;
      el.classList.add('ink-math-error');
      el.textContent = errorText;
    });
    return el;
  }
  ignoreEvent() { return false; }
}

export class ImageWidget extends WidgetType {
  constructor(url, alt, title, pos) {
    super();
    this.url = url;
    this.alt = alt || '';
    this.title = title || '';
    this.pos = pos;
  }
  eq(o) { return o.url === this.url && o.alt === this.alt && o.title === this.title; }
  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'ink-img';
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt;
    if (this.title) img.title = this.title;
    img.loading = 'lazy';
    img.onerror = () => {
      wrap.classList.add('ink-img-broken');
      wrap.textContent = `🖼 ${this.alt || this.url}`;
    };
    wrap.appendChild(img);
    if (this.alt) {
      const cap = document.createElement('span');
      cap.className = 'ink-img-caption';
      cap.textContent = this.alt;
      wrap.appendChild(cap);
    }
    editOnClick(wrap, view, this.pos);
    return wrap;
  }
  ignoreEvent() { return false; }
}

export class HrWidget extends WidgetType {
  constructor(pos) { super(); this.pos = pos; }
  eq() { return true; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'ink-hr';
    el.innerHTML = '<hr>';
    editOnClick(el, view, this.pos);
    return el;
  }
  ignoreEvent() { return false; }
}

export class BulletWidget extends WidgetType {
  constructor(depth) { super(); this.depth = depth; }
  eq(o) { return o.depth === this.depth; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'ink-bullet';
    el.textContent = ['•', '◦', '▪'][this.depth % 3];
    return el;
  }
  ignoreEvent() { return false; }
}

export class CheckboxWidget extends WidgetType {
  constructor(checked, from, to) { super(); this.checked = checked; this.from = from; this.to = to; }
  eq(o) { return o.checked === this.checked && o.from === this.from; }
  toDOM(view) {
    const box = document.createElement('span');
    box.className = 'ink-task' + (this.checked ? ' is-checked' : '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.innerHTML = this.checked
      ? '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M3.5 8.3l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '';
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      if (view.state.readOnly) return; // 阅读模式：勾选不可修改
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' } });
      view.focus();
    });
    return box;
  }
  ignoreEvent() { return true; }
}

/* ---------- 表格 ---------- */
export function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') { // 行内代码里的 | 不切分
      const end = s.indexOf('`', i + 1);
      if (end > -1) { cur += s.slice(i, end + 1); i = end; continue; }
    }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function parseAlign(line) {
  return splitTableRow(line).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  });
}

export function tableToHtml(src, startLine = 0) {
  const lines = src.split('\n');
  const rows = [];
  lines.forEach((text, i) => { if (text.trim()) rows.push({ text, line: startLine + i }); });
  if (rows.length < 2) return null;
  const head = splitTableRow(rows[0].text);
  const align = parseAlign(rows[1].text);
  const body = rows.slice(2);
  const th = head.map((c, i) => {
    const a = align[i] ? ` style="text-align:${align[i]}"` : '';
    return `<th data-r="0" data-c="${i}"${a}>${renderInline(c)}</th>`;
  }).join('');
  const trs = body.map((r, ri) => {
    const cells = splitTableRow(r.text);
    const tds = cells.map((c, i) => {
      const a = align[i] ? ` style="text-align:${align[i]}"` : '';
      return `<td data-r="${ri + 2}" data-c="${i}"${a}>${renderInline(c)}</td>`;
    }).join('');
    return `<tr data-line="${r.line}">${tds}</tr>`;
  }).join('');
  return `<table class="ink-table"><thead><tr data-line="${rows[0].line}">${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ---------- 表格右键菜单（全局单例） ---------- */
let tableMenuEl = null;
let activeTable = null;

function ensureTableMenu() {
  if (tableMenuEl) return tableMenuEl;
  const m = document.createElement('div');
  m.className = 'ink-table-menu hidden';
  m.innerHTML = `
    <button data-op="row-above">在上方插入行</button>
    <button data-op="row-below">在下方插入行</button>
    <button data-op="row-del">删除行</button>
    <div class="sep"></div>
    <button data-op="col-left">在左侧插入列</button>
    <button data-op="col-right">在右侧插入列</button>
    <button data-op="col-del">删除列</button>
    <div class="sep"></div>
    <span class="ink-menu-label">列对齐</span>
    <button data-op="align-left">左对齐</button>
    <button data-op="align-center">居中</button>
    <button data-op="align-right">右对齐</button>
    <div class="sep"></div>
    <button data-op="edit-src">编辑源码</button>
    <button data-op="table-del">删除表格</button>`;
  m.addEventListener('mousedown', (e) => e.preventDefault()); // 菜单点击不抢编辑器焦点
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-op]');
    if (!b) return;
    const t = activeTable;
    hideTableMenu();
    if (t) t.doOp(b.dataset.op);
  });
  document.body.appendChild(m);
  document.addEventListener('mousedown', (e) => {
    if (!tableMenuEl || tableMenuEl.classList.contains('hidden')) return;
    if (!tableMenuEl.contains(e.target)) hideTableMenu();
  });
  tableMenuEl = m;
  return m;
}

function showTableMenu(widget, x, y, r, c) {
  activeTable = widget;
  widget.menuR = r;
  widget.menuC = c;
  const m = ensureTableMenu();
  m.querySelector('[data-op="row-del"]').disabled = r < 2; // 表头不可删行
  m.style.left = Math.min(x, window.innerWidth - 200) + 'px';
  m.style.top = Math.min(y, window.innerHeight - 320) + 'px';
  m.classList.remove('hidden');
}

function hideTableMenu() {
  if (tableMenuEl) tableMenuEl.classList.add('hidden');
  activeTable = null;
}

export class TableWidget extends WidgetType {
  constructor(src, from, lineStarts) {
    super();
    this.src = src;
    this.from = from;
    this.lineStarts = lineStarts; // 行号 -> 文档偏移
    this.needsKatex = src.indexOf('$') > -1; // 单元格含行内公式
    this.katexReady = this.needsKatex && !!katexNow(); // 就绪状态纳入 eq：加载完成后重建重绘
  }
  eq(o) { return o.src === this.src && o.from === this.from && o.katexReady === this.katexReady; }
  toDOM(view) {
    this.view = view;
    const wrap = document.createElement('div');
    wrap.className = 'ink-table-wrap';
    const paint = () => {
      const html = tableToHtml(this.src, 0);
      wrap.innerHTML = sanitizeHtml(html || `<pre>${escapeHtml(this.src)}</pre>`);
    };
    paint();
    // 单元格行内公式依赖 KaTeX：未就绪时 renderInline 先显示源码，加载完成后重建重绘
    if (this.needsKatex && !this.katexReady) {
      loadKatex().then(() => {
        if (!wrap.isConnected) return;
        relayout(view);
      }).catch(() => {});
    }
    wrap.addEventListener('mousedown', (e) => {
      if (view.state.readOnly) return; // 阅读模式：不进入单元格编辑，允许原生选择
      if (e.button === 2) { e.preventDefault(); return; } // 右键：阻止 CM 的指针选择（会把光标移到表格块），留给自定义菜单
      if (e.button !== 0) return;
      const cell = e.target.closest ? e.target.closest('td, th') : null;
      if (cell) {
        if (cell.classList.contains('editing')) return; // 编辑器内点击不干扰
        e.preventDefault();
        if (cell.tagName === 'TH') { this.jumpToSource(); return; }
        this.startCellEdit(cell);
      } else {
        e.preventDefault();
        this.jumpToSource();
      }
    });
    wrap.addEventListener('contextmenu', (e) => {
      if (view.state.readOnly) return; // 阅读模式：不弹出编辑菜单
      const cell = e.target.closest ? e.target.closest('td, th') : null;
      if (!cell) return;
      e.preventDefault();
      showTableMenu(this, e.clientX, e.clientY, Number(cell.dataset.r), Number(cell.dataset.c));
    });
    return wrap;
  }
  ignoreEvent() { return false; }
  jumpToSource() {
    const v = this.view;
    v.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
    v.focus();
  }
  /** 单元格内联编辑：编辑渲染后的纯文本，Enter/失焦提交，Esc 取消 */
  startCellEdit(cell) {
    const v = this.view;
    if (v.state.readOnly) return; // 阅读模式：不可编辑
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    const box = document.createElement('textarea');
    box.className = 'ink-cell-editor';
    box.value = cell.innerText;
    cell.classList.add('editing');
    cell.appendChild(box);
    box.focus();
    box.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const text = box.value;
      cell.classList.remove('editing');
      box.remove();
      if (!commit) return;
      const newSrc = setCell(this.src, r - 2, c, text);
      if (newSrc !== this.src) {
        v.dispatch({ changes: { from: this.from, to: this.from + this.src.length, insert: newSrc } });
      }
      v.focus();
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else e.stopPropagation(); // 不让 CodeMirror 的快捷键拦截输入
    });
    box.addEventListener('blur', () => finish(true));
  }
  doOp(op) {
    const v = this.view;
    if (v.state.readOnly) return; // 阅读模式：不可编辑
    const from = this.from;
    const to = this.from + this.src.length;
    const r = this.menuR;
    const c = this.menuC;
    let ns = null;
    switch (op) {
      case 'row-above': ns = insertRow(this.src, r - 2, 'above'); break;
      case 'row-below': ns = insertRow(this.src, r - 2, 'below'); break;
      case 'row-del': ns = deleteRow(this.src, r - 2); break;
      case 'col-left': ns = insertCol(this.src, c, 'left'); break;
      case 'col-right': ns = insertCol(this.src, c, 'right'); break;
      case 'col-del': ns = deleteCol(this.src, c); break;
      case 'align-left': ns = setColAlign(this.src, c, 'left'); break;
      case 'align-center': ns = setColAlign(this.src, c, 'center'); break;
      case 'align-right': ns = setColAlign(this.src, c, 'right'); break;
      case 'edit-src': this.jumpToSource(); return;
      case 'table-del': ns = ''; break;
      default: return;
    }
    if (ns == null || ns === this.src) return;
    v.dispatch({ changes: { from, to, insert: ns } });
    v.focus();
  }
}

export class CodeInfoWidget extends WidgetType {
  constructor(lang) { super(); this.lang = lang; }
  eq(o) { return o.lang === this.lang; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'ink-code-lang';
    el.textContent = this.lang;
    return el;
  }
  ignoreEvent() { return true; }
}

/* ---------- Mermaid 图 ---------- */
const mermaidCache = new Map(); // code\0theme -> svg

export class MermaidWidget extends WidgetType {
  constructor(code, from) {
    super();
    this.code = code;
    this.from = from;
    this.theme = mermaidTheme(); // 主题变化时 eq 不相等 -> 重建重渲染
    this.svg = mermaidCache.get(code + '\0' + this.theme) || null;
  }
  eq(o) { return o.code === this.code && o.from === this.from && o.theme === this.theme && o.svg === this.svg; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'ink-mermaid';
    editOnClick(el, view, this.from);
    if (this.svg != null) { // 缓存命中：同步显示，滚动回视口无需重渲染
      el.innerHTML = this.svg;
      el.classList.add('ready');
      return el;
    }
    el.textContent = '🔄 渲染图中…';
    loadMermaid()
      .then(() => renderMermaid(this.code, this.theme))
      .then((svg) => {
        cachePut(mermaidCache, this.code + '\0' + this.theme, svg, 30);
        if (el.isConnected) {
          el.innerHTML = svg;
          el.classList.add('ready');
        }
        relayout(view); // 重建 widget（eq 因 svg 就绪而不相等）→ CM 替换 DOM 并重新测量
      })
      .catch((err) => {
        if (!el.isConnected) return;
        el.textContent = 'Mermaid 渲染失败：' + (err && err.message ? err.message : String(err)) + '（点击查看源码）';
        el.classList.add('error');
        relayout(view); // 错误文本同样改变块高
      });
    return el;
  }
  ignoreEvent() { return false; }
}
