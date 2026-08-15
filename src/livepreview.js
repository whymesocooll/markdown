// 实时所见即所得核心：根据语法树 + 光标位置生成装饰
// 规则：光标所在节点显示 Markdown 源码，其余位置隐藏标记并直接渲染效果
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  MathWidget, ImageWidget, HrWidget, BulletWidget, CheckboxWidget, TableWidget, MermaidWidget
} from './widgets.js';

const HIDE = Decoration.replace({});
export const refreshEffect = StateEffect.define();
export const sourceModeEffect = StateEffect.define();
export const readModeEffect = StateEffect.define();

export const sourceModeField = StateField.define({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(sourceModeEffect)) return !!e.value;
    return v;
  }
});

/** 阅读模式：内容只读，且无论光标在哪都显示渲染效果、永不显示 Markdown 源码 */
export const readModeField = StateField.define({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(readModeEffect)) return !!e.value;
    return v;
  }
});

const CODE_CTX = /^(FencedCode|CodeBlock|CodeText|InlineCode|HTMLBlock|HTMLTag|Comment|CommentBlock|URL|LinkTitle|Link|Image)$/;

function inCodeContext(tree, pos) {
  let n = tree.resolveInner(pos, 1);
  for (let c = n; c; c = c.parent) if (CODE_CTX.test(c.name)) return true;
  return false;
}

function buildDeco(state) {
  const doc = state.doc;
  const empty = { deco: Decoration.none };
  if (state.field(sourceModeField, false)) return empty;
  if (doc.length > 600000) return empty; // 超大文档降级为纯源码高亮，保证流畅

  const tree = syntaxTree(state);
  const sel = state.selection;
  // 阅读模式下 touched 恒为 false：点击/光标进入任何节点都不显示源码
  const readMode = state.field(readModeField, false);
  const touched = readMode ? () => false : (from, to) => {
    for (const r of sel.ranges) if (r.from <= to && r.to >= from) return true;
    return false;
  };
  const lineTouched = (pos) => {
    const l = doc.lineAt(pos);
    return touched(l.from, l.to);
  };

  const blocks = [];
  const lines = [];
  const inlines = [];
  const hideRun = (from, to, lineTo) => {
    let end = to;
    while (end < lineTo && doc.sliceString(end, end + 1) === ' ') end++;
    return HIDE.range(from, end);
  };

  tree.iterate({
    enter: (node) => {
      const name = node.name;
      switch (name) {
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          const lvl = Number(name.slice(-1));
          lines.push(Decoration.line({ class: `ink-h ink-h${lvl}` }).range(doc.lineAt(node.from).from));
          break;
        }
        case 'SetextHeading1': case 'SetextHeading2': {
          const lvl = name.endsWith('1') ? 1 : 2;
          lines.push(Decoration.line({ class: `ink-h ink-h${lvl}` }).range(doc.lineAt(node.from).from));
          break;
        }
        case 'HeaderMark': {
          const line = doc.lineAt(node.from);
          if (/^\s*(=+|-+)\s*$/.test(line.text)) {
            inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
            break;
          }
          if (!touched(line.from, line.to)) inlines.push(hideRun(node.from, node.to, line.to));
          else inlines.push(Decoration.mark({ class: 'ink-mark ink-hmark' }).range(node.from, node.to));
          break;
        }
        case 'Blockquote': {
          let p = node.from;
          for (;;) {
            const l = doc.lineAt(p);
            lines.push(Decoration.line({ class: 'ink-quote' }).range(l.from));
            if (l.to >= node.to) break;
            p = l.to + 1;
          }
          break;
        }
        case 'QuoteMark': {
          const line = doc.lineAt(node.from);
          if (!touched(line.from, line.to)) inlines.push(hideRun(node.from, node.to, line.to));
          else inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
          break;
        }
        case 'ListMark': {
          const line = doc.lineAt(node.from);
          const txt = doc.sliceString(node.from, node.to);
          lines.push(Decoration.line({ class: 'ink-li' }).range(line.from));
          // 任务列表行不渲染 bullet，只交给复选框 widget
          const isTask = /^\s*[-*+] \[[ xX]\] /.test(line.text);
          if (!isTask && /^[-*+]$/.test(txt)) {
            const depth = Math.floor((node.from - line.from) / 2);
            if (!touched(line.from, line.to)) {
              inlines.push(Decoration.replace({ widget: new BulletWidget(depth) }).range(node.from, node.to));
            } else {
              inlines.push(Decoration.mark({ class: 'ink-listmark' }).range(node.from, node.to));
            }
          } else {
            inlines.push(Decoration.mark({ class: 'ink-listmark' }).range(node.from, node.to));
          }
          break;
        }
        case 'TaskMarker': {
          const checked = /[xX]/.test(doc.sliceString(node.from, node.to));
          inlines.push(Decoration.replace({
            widget: new CheckboxWidget(checked, node.from, node.to)
          }).range(node.from, node.to));
          break;
        }
        case 'HorizontalRule': {
          const line = doc.lineAt(node.from);
          if (!touched(line.from, line.to)) {
            blocks.push(Decoration.replace({ widget: new HrWidget(line.from), block: true, inclusiveEnd: false }).range(line.from, Math.min(line.to + 1, doc.length)));
          } else {
            lines.push(Decoration.line({ class: 'ink-hr-src' }).range(line.from));
          }
          break;
        }
        case 'FencedCode': case 'CodeBlock': {
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          let info = '';
          const infoNode = node.node.getChild ? node.node.getChild('CodeInfo') : null;
          if (infoNode) info = doc.sliceString(infoNode.from, infoNode.to).trim();
          // mermaid 代码块在非光标行渲染为图表
          if (name === 'FencedCode' && /^mermaid$/i.test(info) && !touched(first.from, last.to)) {
            const code = doc.sliceString(first.from, last.to)
              .replace(/^\s{0,3}```+[^\n]*\n/, '')
              .replace(/\n```+\s*$/, '');
            blocks.push(Decoration.replace({
              widget: new MermaidWidget(code, first.from), block: true, inclusiveEnd: false
            }).range(first.from, Math.min(last.to + 1, doc.length)));
            return false;
          }
          for (let ln = first.number; ln <= last.number; ln++) {
            const l = doc.line(ln);
            const cls = ['ink-code'];
            if (ln === first.number) cls.push('ink-code-open');
            if (ln === last.number) cls.push('ink-code-close');
            const spec = { class: cls.join(' ') };
            if (ln === first.number && info) spec.attributes = { 'data-lang': info };
            lines.push(Decoration.line(spec).range(l.from));
          }
          break;
        }
        case 'CodeInfo': {
          inlines.push(Decoration.mark({ class: 'ink-fence' }).range(node.from, node.to));
          break;
        }
        case 'CodeMark': {
          const par = node.node.parent;
          if (par && par.name === 'InlineCode') {
            if (!touched(par.from, par.to)) inlines.push(HIDE.range(node.from, node.to));
            else inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
          } else {
            inlines.push(Decoration.mark({ class: 'ink-fence' }).range(node.from, node.to));
          }
          break;
        }
        case 'InlineCode':
          inlines.push(Decoration.mark({ class: 'ink-inline-code' }).range(node.from, node.to));
          break;
        case 'Emphasis':
          inlines.push(Decoration.mark({ class: 'ink-em' }).range(node.from, node.to));
          break;
        case 'StrongEmphasis':
          inlines.push(Decoration.mark({ class: 'ink-strong' }).range(node.from, node.to));
          break;
        case 'Strikethrough':
          inlines.push(Decoration.mark({ class: 'ink-del' }).range(node.from, node.to));
          break;
        case 'EmphasisMark': case 'StrikethroughMark': {
          const par = node.node.parent;
          if (par && !touched(par.from, par.to)) inlines.push(HIDE.range(node.from, node.to));
          else inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
          break;
        }
        case 'Link': {
          const urlNode = node.node.getChild ? node.node.getChild('URL') : null;
          const href = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : '';
          const spec = { class: 'ink-link' };
          if (href) spec.attributes = { 'data-href': href, title: href + '  (Ctrl/⌘+单击打开)' };
          inlines.push(Decoration.mark(spec).range(node.from, node.to));
          break;
        }
        case 'LinkMark': case 'URL': case 'LinkTitle': {
          const par = node.node.parent;
          const pn = par ? par.name : '';
          if ((pn === 'Link' || pn === 'Image') && !touched(par.from, par.to)) {
            inlines.push(HIDE.range(node.from, node.to));
          } else {
            inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
          }
          break;
        }
        case 'Image': {
          if (!touched(node.from, node.to)) {
            const raw = doc.sliceString(node.from, node.to);
            const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+["']([^"']*)["'])?\s*\)$/.exec(raw);
            if (m && m[2]) {
              const line = doc.lineAt(node.from);
              if (line.text.trim() === raw.trim()) {
                blocks.push(Decoration.replace({
                  widget: new ImageWidget(m[2], m[1], m[3], line.from), block: true, inclusiveEnd: false
                }).range(line.from, Math.min(line.to + 1, doc.length)));
              } else {
                inlines.push(Decoration.replace({
                  widget: new ImageWidget(m[2], m[1], m[3], node.from)
                }).range(node.from, node.to));
              }
              return false;
            }
          }
          break;
        }
        case 'Table': {
          const first = doc.lineAt(node.from);
          const last = doc.lineAt(node.to);
          if (!touched(first.from, last.to)) {
            const src = doc.sliceString(first.from, last.to);
            const starts = [];
            for (let ln = first.number; ln <= last.number; ln++) starts.push(doc.line(ln).from);
            blocks.push(Decoration.replace({
              widget: new TableWidget(src, first.from, starts), block: true, inclusiveEnd: false
            }).range(first.from, Math.min(last.to + 1, doc.length)));
            return false;
          }
          for (let ln = first.number; ln <= last.number; ln++) {
            lines.push(Decoration.line({ class: 'ink-table-src' }).range(doc.line(ln).from));
          }
          break;
        }
        case 'TableDelimiter':
          inlines.push(Decoration.mark({ class: 'ink-mark' }).range(node.from, node.to));
          break;
        default:
          break;
      }
      return undefined;
    }
  });

  /* ---------- 块级数学公式 $$ ... $$ ---------- */
  const blockedLines = new Set();
  const customRanges = [];
  const customDecos = [];
  const markBlocked = (from, to) => {
    const a = doc.lineAt(from).number;
    const z = doc.lineAt(to).number;
    for (let i = a; i <= z; i++) blockedLines.add(i);
  };
  for (const b of blocks) markBlocked(b.from, b.to);

  const isFence = (t) => /^\s{0,3}\$\$/.test(t);
  for (let i = 1; i <= doc.lines; i++) {
    if (blockedLines.has(i)) continue;
    const line = doc.line(i);
    if (!isFence(line.text) || inCodeContext(tree, line.from)) continue;
    const single = /^\s{0,3}\$\$(.+)\$\$\s*$/.exec(line.text);
    let endLine = i;
    let tex = '';
    if (single) {
      tex = single[1];
    } else {
      let j = i + 1;
      while (j <= doc.lines && !/\$\$\s*$/.test(doc.line(j).text)) j++;
      if (j > doc.lines) continue;
      endLine = j;
      const body = [];
      for (let k = i; k <= j; k++) body.push(doc.line(k).text);
      tex = body.join('\n').replace(/^\s{0,3}\$\$/, '').replace(/\$\$\s*$/, '');
    }
    const from = line.from;
    const to = doc.line(endLine).to;
    if (!touched(from, to)) {
      // 范围包含行尾换行符 + inclusiveEnd:false：整行被 widget 吞掉且不残留空行元素、
      // 也不吞掉下一行（残留空行会让点击坐标整体下移一行）
      const fullTo = Math.min(to + 1, doc.length);
      blocks.push(Decoration.replace({ widget: new MathWidget(tex.trim(), true, from), block: true, inclusiveEnd: false }).range(from, fullTo));
      markBlocked(from, to);
    } else {
      for (let k = i; k <= endLine; k++) lines.push(Decoration.line({ class: 'ink-math-src' }).range(doc.line(k).from));
      for (let k = i; k <= endLine; k++) blockedLines.add(-k); // 仅占位，避免行内扫描重复处理
      // 隐藏 $$ 分隔符：光标进入公式编辑时只显示源码，保持沉浸式
      const firstLine = doc.line(i);
      const lastLine = doc.line(endLine);
      const open = /^\s{0,3}\$\$/.exec(firstLine.text);
      if (open) customDecos.push(HIDE.range(firstLine.from, firstLine.from + open[0].length));
      const close = /\$\$\s*$/.exec(lastLine.text);
      if (close) customDecos.push(HIDE.range(lastLine.to - close[0].length, lastLine.to));
    }
    i = endLine;
  }

  /* ---------- 行内数学公式 / ==高亮== ---------- */
  const INLINE_MATH = /(?<!\\)\$(?!\s)((?:[^$\\\n]|\\.)+?)(?<!\\)\$/g;
  const HIGHLIGHT = /(?<!\\)==(?!\s)([^\n=]+?)==/g;
  for (let i = 1; i <= doc.lines; i++) {
    if (blockedLines.has(i) || blockedLines.has(-i)) continue;
    const line = doc.line(i);
    if (!line.text) continue;
    if (line.text.indexOf('$') > -1) {
      INLINE_MATH.lastIndex = 0;
      let m;
      while ((m = INLINE_MATH.exec(line.text))) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        if (inCodeContext(tree, from + 1)) continue;
        if (touched(from, to)) {
          customDecos.push(Decoration.mark({ class: 'ink-math-src-inline' }).range(from, to));
          // 隐藏行内公式的 $ 分隔符：只显示源码，保持沉浸式
          customDecos.push(HIDE.range(from, from + 1));
          customDecos.push(HIDE.range(to - 1, to));
        } else {
          customDecos.push(Decoration.replace({ widget: new MathWidget(m[1], false, from) }).range(from, to));
        }
        customRanges.push([from, to]);
      }
    }
    if (line.text.indexOf('==') > -1) {
      HIGHLIGHT.lastIndex = 0;
      let m;
      while ((m = HIGHLIGHT.exec(line.text))) {
        const from = line.from + m.index;
        const to = from + m[0].length;
        if (inCodeContext(tree, from + 2)) continue;
        if (customRanges.some(([a, b]) => from < b && to > a)) continue;
        customDecos.push(Decoration.mark({ class: 'ink-highlight' }).range(from, to));
        if (!touched(from, to)) {
          customDecos.push(HIDE.range(from, from + 2));
          customDecos.push(HIDE.range(to - 2, to));
        }
        customRanges.push([from, to]);
      }
    }
  }

  /* ---------- 合并 + 冲突过滤 ---------- */
  // 语法树装饰与自定义（公式/高亮）装饰若部分重叠会导致 replace 冲突，需剔除
  const conflicts = (from, to) => customRanges.some(
    ([a, b]) => from < b && to > a && !(from <= a && to >= b)
  );
  const keep = (d) => !blockedLines.has(doc.lineAt(d.from).number);
  const keepInline = (d) => keep(d) && !conflicts(d.from, d.to);

  const all = blocks
    .concat(lines.filter(keep))
    .concat(inlines.filter(keepInline))
    .concat(customDecos.filter(keep));

  return { deco: Decoration.set(all, true) };
}

export const livePreviewField = StateField.define({
  create: (state) => buildDeco(state),
  update(value, tr) {
    const selChanged = !tr.state.selection.eq(tr.startState.selection);
    const forced = tr.effects.some((e) => e.is(refreshEffect) || e.is(sourceModeEffect) || e.is(readModeEffect));
    if (tr.docChanged || selChanged || forced) return buildDeco(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
});

// 语法树异步解析 / 语言包懒加载完成后，刷新一次装饰
export const parseWatcher = ViewPlugin.fromClass(class {
  constructor(view) { this.tree = syntaxTree(view.state); }
  update(u) {
    const tree = syntaxTree(u.state);
    if (tree !== this.tree) {
      this.tree = tree;
      if (!u.docChanged) {
        const view = u.view;
        Promise.resolve().then(() => {
          if (view.dom.isConnected) view.dispatch({ effects: refreshEffect.of(null) });
        });
      }
    }
  }
});

// Ctrl / ⌘ + 单击打开链接
export const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const el = event.target && event.target.closest ? event.target.closest('.ink-link') : null;
    const href = el && el.dataset ? el.dataset.href : null;
    if (href) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener');
      return true;
    }
    return false;
  }
});
