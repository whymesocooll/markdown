// 快捷格式化命令：工具栏与快捷键共用
import { EditorSelection } from '@codemirror/state';

export function toggleWrap(view, before, after = before) {
  if (view.state.readOnly) return false; // 阅读模式：不修改内容
  const spec = view.state.changeByRange((range) => {
    const doc = view.state.doc;
    const { from, to } = range;
    const bl = before.length;
    const al = after.length;
    const outerBefore = doc.sliceString(Math.max(0, from - bl), from);
    const outerAfter = doc.sliceString(to, Math.min(doc.length, to + al));
    if (outerBefore === before && outerAfter === after) {
      return {
        changes: [{ from: from - bl, to: from }, { from: to, to: to + al }],
        range: EditorSelection.range(from - bl, to - bl)
      };
    }
    const inner = doc.sliceString(from, to);
    if (inner.length >= bl + al && inner.startsWith(before) && inner.endsWith(after)) {
      return {
        changes: [{ from, to, insert: inner.slice(bl, inner.length - al) }],
        range: EditorSelection.range(from, to - bl - al)
      };
    }
    if (from === to) {
      return { changes: { from, insert: before + after }, range: EditorSelection.cursor(from + bl) };
    }
    return {
      changes: [{ from, insert: before }, { from: to, insert: after }],
      range: EditorSelection.range(from + bl, to + bl)
    };
  });
  view.dispatch(spec, { scrollIntoView: true, userEvent: 'input.format' });
  view.focus();
  return true;
}

function eachSelectedLine(state, fn) {
  const changes = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const out = fn(line, seen.size - 1);
      if (out != null && out !== line.text) changes.push({ from: line.from, to: line.to, insert: out });
    }
  }
  return changes;
}

export function setHeading(view, level) {
  if (view.state.readOnly) return false; // 阅读模式：不修改内容
  const changes = eachSelectedLine(view.state, (line) => {
    const m = /^(\s*)(#{1,6} +)?([\s\S]*)$/.exec(line.text);
    const indent = m[1] || '';
    const cur = m[2] || '';
    const rest = m[3] || '';
    const curLevel = cur ? cur.trim().length : 0;
    const target = curLevel === level ? 0 : level;
    return indent + (target ? '#'.repeat(target) + ' ' : '') + rest;
  });
  view.dispatch({ changes, userEvent: 'input.format' });
  view.focus();
  return true;
}

const PREFIX = {
  quote: { re: /^(\s*)> ?/, make: (i) => '> ' },
  ul: { re: /^(\s*)[-*+] (?!\[[ xX]\] )/, make: () => '- ' },
  task: { re: /^(\s*)[-*+] \[[ xX]\] /, make: () => '- [ ] ' },
  ol: { re: /^(\s*)\d+[.)] /, make: (i) => `${i + 1}. ` }
};

export function toggleLinePrefix(view, kind) {
  if (view.state.readOnly) return false; // 阅读模式：不修改内容
  const conf = PREFIX[kind];
  if (!conf) return false;
  const state = view.state;
  let allHave = true;
  eachSelectedLine(state, (line) => {
    if (line.text.trim() && !conf.re.test(line.text)) allHave = false;
    return null;
  });
  const changes = [];
  let idx = 0;
  eachSelectedLine(state, (line) => {
    if (!line.text.trim() && state.selection.main.from !== state.selection.main.to) return null;
    const indentM = /^(\s*)/.exec(line.text);
    const indent = indentM ? indentM[1] : '';
    const body = line.text.slice(indent.length);
    // 只识别行首已存在的各类前缀（缩进之后），做最小编辑，避免整行替换破坏选区映射
    const matched = Object.values(PREFIX)
      .map((c) => c.re.exec(body))
      .find((m) => m);
    const oldPrefix = matched ? matched[0] : '';
    const newPrefix = allHave ? '' : conf.make(idx++);
    if (oldPrefix === newPrefix) return null;
    const at = line.from + indent.length;
    changes.push({ from: at, to: at + oldPrefix.length, insert: newPrefix });
    return null;
  });
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: 'input.format' });
  view.focus();
  return true;
}

export function insertText(view, text, caretOffset = null) {
  if (view.state.readOnly) return false; // 阅读模式：不修改内容
  const r = view.state.selection.main;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + (caretOffset == null ? text.length : caretOffset) },
    scrollIntoView: true,
    userEvent: 'input.format'
  });
  view.focus();
  return true;
}

/** 在独立块中插入（自动补前后空行） */
export function insertBlock(view, text, caretOffset = null) {
  if (view.state.readOnly) return false; // 阅读模式：不修改内容
  const state = view.state;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  const atLineStart = r.from === line.from;
  const emptyLine = line.text.trim() === '';
  let prefix = '';
  if (!emptyLine) prefix = atLineStart ? '' : '\n';
  if (!emptyLine && !atLineStart) prefix = '\n\n';
  const insert = prefix + text;
  const pos = r.from + prefix.length + (caretOffset == null ? text.length : caretOffset);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: pos },
    scrollIntoView: true,
    userEvent: 'input.format'
  });
  view.focus();
  return true;
}

export function insertCodeBlock(view, lang = '') {
  const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const body = sel || '';
  const text = '```' + lang + '\n' + body + '\n```';
  return insertBlock(view, text, 3 + lang.length + 1 + body.length);
}

export function insertTable(view, rows = 2, cols = 3) {
  const head = '| ' + Array.from({ length: cols }, (_, i) => `列 ${i + 1}`).join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
  const body = Array.from({ length: rows }, () => '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |').join('\n');
  return insertBlock(view, `${head}\n${sep}\n${body}\n`, 2);
}

export function insertLink(view) {
  const r = view.state.selection.main;
  const sel = view.state.sliceDoc(r.from, r.to);
  if (/^(https?:\/\/|mailto:|\/|\.\/)/i.test(sel)) return insertText(view, `[](${sel})`, 1);
  return insertText(view, `[${sel}](url)`, sel ? sel.length + 3 : 1);
}

export function insertImage(view, url = '', alt = '') {
  const r = view.state.selection.main;
  const sel = view.state.sliceDoc(r.from, r.to);
  const a = alt || sel || '';
  const text = `![${a}](${url})`;
  return insertText(view, text, url ? text.length : text.length - 1);
}

export function insertHr(view) { return insertBlock(view, '\n---\n'); }
export function insertMathBlock(view) { return insertBlock(view, '$$\n\n$$', 3); }
export function insertInlineMath(view) { return toggleWrap(view, '$'); }
export function insertFootnote(view) {
  const id = Math.random().toString(36).slice(2, 6);
  return insertText(view, `[^${id}]`);
}

export const formatKeymap = [
  { key: 'Mod-b', run: (v) => toggleWrap(v, '**') },
  { key: 'Mod-i', run: (v) => toggleWrap(v, '*') },
  { key: 'Mod-Shift-x', run: (v) => toggleWrap(v, '~~') },
  { key: 'Mod-Shift-h', run: (v) => toggleWrap(v, '==') },
  { key: 'Mod-`', run: (v) => toggleWrap(v, '`') },
  { key: 'Mod-Shift-k', run: (v) => insertCodeBlock(v) },
  { key: 'Mod-k', run: (v) => insertLink(v) },
  { key: 'Mod-Shift-i', run: (v) => insertImage(v) },
  { key: 'Mod-Shift-q', run: (v) => toggleLinePrefix(v, 'quote') },
  { key: 'Mod-Shift-l', run: (v) => toggleLinePrefix(v, 'ul') },
  { key: 'Mod-Shift-o', run: (v) => toggleLinePrefix(v, 'ol') },
  { key: 'Mod-Shift-t', run: (v) => toggleLinePrefix(v, 'task') },
  { key: 'Mod-Shift-m', run: (v) => insertInlineMath(v) },
  { key: 'Mod-Shift-Minus', run: (v) => insertHr(v) },
  { key: 'Mod-0', run: (v) => setHeading(v, 0) },
  { key: 'Mod-1', run: (v) => setHeading(v, 1) },
  { key: 'Mod-2', run: (v) => setHeading(v, 2) },
  { key: 'Mod-3', run: (v) => setHeading(v, 3) },
  { key: 'Mod-4', run: (v) => setHeading(v, 4) },
  { key: 'Mod-5', run: (v) => setHeading(v, 5) },
  { key: 'Mod-6', run: (v) => setHeading(v, 6) }
];
