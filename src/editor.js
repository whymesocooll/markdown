// CodeMirror 6 编辑器装配
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView, keymap, drawSelection, dropCursor, rectangularSelection,
  crosshairCursor, highlightActiveLine, placeholder, highlightSpecialChars
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, indentOnInput, indentUnit, bracketMatching } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { codeLanguages } from './langs.js';
import { livePreviewField, sourceModeField, readModeField, parseWatcher, linkClickHandler } from './livepreview.js';
import { formatKeymap } from './commands.js';

/** 语法高亮配色：全部走 CSS 变量，切主题时无需重建编辑器 */
export const inkHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-h' },
  { tag: t.heading2, class: 'tok-h' },
  { tag: t.heading3, class: 'tok-h' },
  { tag: t.heading4, class: 'tok-h' },
  { tag: t.heading5, class: 'tok-h' },
  { tag: t.heading6, class: 'tok-h' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, class: 'tok-link' },
  { tag: t.url, class: 'tok-url' },
  { tag: t.monospace, class: 'tok-mono' },
  { tag: t.comment, class: 'tok-comment' },
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], class: 'tok-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'tok-string' },
  { tag: [t.number, t.bool, t.atom, t.null], class: 'tok-number' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], class: 'tok-func' },
  { tag: [t.typeName, t.className, t.namespace, t.self], class: 'tok-type' },
  { tag: [t.propertyName, t.attributeName], class: 'tok-prop' },
  { tag: [t.variableName, t.definition(t.variableName)], class: 'tok-var' },
  { tag: [t.operator, t.operatorKeyword, t.derefOperator], class: 'tok-op' },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket], class: 'tok-punct' },
  { tag: [t.meta, t.annotation, t.processingInstruction], class: 'tok-meta' },
  { tag: t.tagName, class: 'tok-tag' },
  { tag: t.invalid, class: 'tok-invalid' }
]);

export const readOnlyComp = new Compartment();
export const spellcheckComp = new Compartment();

export function createEditor({ parent, doc = '', onChange, onSelection, extra = [] }) {
  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && onChange) onChange(u.state.doc.toString(), u);
    if ((u.selectionSet || u.docChanged) && onSelection) onSelection(u.state);
  });

  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      placeholder('开始写作…  输入 # 标题、- 列表、``` 代码块，或按 Ctrl+B 加粗'),
      markdown({ base: markdownLanguage, codeLanguages, addKeymap: true }),
      syntaxHighlighting(inkHighlightStyle),
      sourceModeField,
      readModeField,
      livePreviewField,
      parseWatcher,
      linkClickHandler,
      keymap.of([
        ...formatKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab
      ]),
      spellcheckComp.of(EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off' })),
      readOnlyComp.of([]),
      listener,
      ...extra
    ]
  });

  return new EditorView({ state, parent });
}

export function setDoc(view, text) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(0),
    scrollIntoView: true
  });
}
