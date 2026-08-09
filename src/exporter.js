// 导出：Markdown -> HTML（含公式与代码高亮）-> 文件 / 打印 PDF
import { marked } from 'marked';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import { escapeHtml, slugify } from './utils.js';
import { KATEX_CSS, HLJS_DARK_CSS, HLJS_LIGHT_CSS, DOC_CSS } from './gen-assets.js';
import { renderMermaid } from './mermaid.js';

const MATH_TOKEN = (i) => `@@INKMATH${i}@@`;

function extractMath(md) {
  const store = [];
  const lines = String(md).split('\n');
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const fm = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) {
      out.push(line);
      if (fm && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fm) { fence = fm[1]; out.push(line); continue; }

    if (/^\s{0,3}\$\$/.test(line)) {
      const single = /^\s{0,3}\$\$([\s\S]+)\$\$\s*$/.exec(line);
      if (single) {
        store.push({ tex: single[1], display: true });
        out.push(MATH_TOKEN(store.length - 1));
        continue;
      }
      let j = i + 1;
      const body = [];
      while (j < lines.length && !/\$\$\s*$/.test(lines[j])) { body.push(lines[j]); j++; }
      if (j < lines.length) {
        const tail = lines[j].replace(/\$\$\s*$/, '');
        if (tail.trim()) body.push(tail);
        const head = line.replace(/^\s{0,3}\$\$/, '');
        store.push({ tex: [head, ...body].join('\n').trim(), display: true });
        out.push(MATH_TOKEN(store.length - 1));
        i = j;
        continue;
      }
    }

    line = line.replace(/(`+)([\s\S]*?)\1|(?<!\\)\$(?!\s)((?:[^$\\\n]|\\.)+?)(?<!\\)\$/g,
      (m, tick, _code, tex) => {
        if (tick) return m;
        store.push({ tex, display: false });
        return MATH_TOKEN(store.length - 1);
      });
    out.push(line);
  }
  return { text: out.join('\n'), store };
}

function restoreMath(html, store) {
  let s = html.replace(/<p>\s*@@INKMATH(\d+)@@\s*<\/p>/g, (m, i) => renderTex(store[Number(i)], true));
  s = s.replace(/@@INKMATH(\d+)@@/g, (m, i) => renderTex(store[Number(i)], false));
  return s;
}

function renderTex(item, wrap) {
  if (!item) return '';
  try {
    const html = katex.renderToString(item.tex, {
      displayMode: item.display, throwOnError: false, strict: 'ignore', output: 'html', trust: false
    });
    return item.display && wrap ? `<div class="math-block">${html}</div>` : html;
  } catch (e) {
    return `<code>${escapeHtml(item.tex)}</code>`;
  }
}

let configured = false;
function configureMarked() {
  if (configured) return;
  configured = true;
  marked.use({
    gfm: true,
    breaks: false,
    renderer: {
      code(codeOrToken, infoString) {
        const isObj = codeOrToken && typeof codeOrToken === 'object';
        const code = isObj ? codeOrToken.text : codeOrToken;
        const info = (isObj ? codeOrToken.lang : infoString) || '';
        const lang = String(info).split(/\s+/)[0];
        let body;
        try {
          body = lang && hljs.getLanguage(lang)
            ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
            : hljs.highlightAuto(code).value;
        } catch (e) {
          body = escapeHtml(code);
        }
        return `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code class="hljs language-${escapeHtml(lang || 'text')}">${body}</code></pre>\n`;
      },
      heading(textOrToken, levelArg) {
        const isObj = textOrToken && typeof textOrToken === 'object';
        const level = isObj ? textOrToken.depth : levelArg;
        const text = isObj ? this.parser.parseInline(textOrToken.tokens) : textOrToken;
        const id = slugify(String(text).replace(/<[^>]+>/g, ''));
        return `<h${level} id="${id}">${text}</h${level}>\n`;
      }
    }
  });
}

export function renderMarkdown(md) {
  configureMarked();
  const { text, store } = extractMath(md);
  const html = marked.parse(text);
  return restoreMath(html, store);
}

/* ---------- Mermaid：块 -> 占位 token -> 渲染为内联 SVG ---------- */
const MERMAID_TOKEN = (i) => `@@INKMERMAID${i}@@`;

function extractMermaid(md) {
  const store = [];
  const lines = String(md).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s{0,3}(```+|~~~+)\s*(mermaid)\s*$/.exec(lines[i]);
    if (fm) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !/^\s{0,3}```+\s*$/.test(lines[j])) { body.push(lines[j]); j++; }
      if (j < lines.length) {
        store.push(body.join('\n'));
        out.push(MERMAID_TOKEN(store.length - 1));
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return { text: out.join('\n'), store };
}

/** 异步版：文档含 mermaid 时渲染为内联 SVG（无 mermaid 时结果与 renderMarkdown 一致） */
export async function renderMarkdownAsync(md) {
  configureMarked();
  const { text: t1, store: mstore } = extractMath(md);
  const { text: t2, store: mmstore } = extractMermaid(t1);
  const html = marked.parse(t2);
  let s = restoreMath(html, mstore);
  for (let i = 0; i < mmstore.length; i++) {
    const svg = await renderMermaid(mmstore[i], 'light');
    s = s.replace(
      new RegExp(`<p>\\s*${MERMAID_TOKEN(i)}\\s*<\\/p>`),
      `<div class="mermaid-block">${svg}</div>`
    ).replace(new RegExp(MERMAID_TOKEN(i), 'g'), `<div class="mermaid-block">${svg}</div>`);
  }
  return s;
}

export function buildStandaloneHtml(md, { title = 'Document', theme = 'light' } = {}) {
  const body = renderMarkdown(md);
  return wrapHtml(body, { title, theme });
}

/** 异步版：mermaid 块渲染为内联 SVG，其余与 buildStandaloneHtml 一致 */
export async function buildStandaloneHtmlAsync(md, { title = 'Document', theme = 'light' } = {}) {
  const body = await renderMarkdownAsync(md);
  return wrapHtml(body, { title, theme });
}

function wrapHtml(body, { title, theme }) {
  const hl = theme === 'dark' ? HLJS_DARK_CSS : HLJS_LIGHT_CSS;
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${KATEX_CSS}</style>
<style>${hl}</style>
<style>${DOC_CSS}</style>
</head>
<body class="ink-doc theme-${theme}">
<article class="ink-article">
${body}
</article>
</body>
</html>`;
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

export async function printToPdf(md, { title = 'Document', theme = 'light' } = {}) {
  const html = (await buildStandaloneHtmlAsync(md, { title, theme }))
    .replace('</head>', `<style>
@page { margin: 18mm 16mm; }
body { background: #fff !important; }
.ink-article { max-width: none; padding: 0; }
@media print { a { color: inherit; text-decoration: underline; } pre, table, blockquote, .math-block { break-inside: avoid; } h1,h2,h3 { break-after: avoid; } }
</style></head>`);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 60000);
    }
  };
  if (doc.readyState === 'complete') setTimeout(go, 400);
  else iframe.onload = () => setTimeout(go, 400);
}
