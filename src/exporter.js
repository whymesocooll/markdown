// 导出：Markdown -> HTML（含公式与代码高亮）-> 文件 / 打印 PDF
// marked / highlight.js / KaTeX 均为按需加载：导出是低频操作，不进入启动包
import { escapeHtml, slugify, collectHeadings } from './utils.js';
import { KATEX_CSS, HLJS_DARK_CSS, HLJS_LIGHT_CSS, DOC_CSS } from './gen-assets.js';
import { renderMermaid } from './mermaid.js';
import { isDesktop, desktopExportPdf } from './desktop.js';
import { loadKatex } from './katex-loader.js';

let depsPromise = null;
function loadExportDeps() {
  if (!depsPromise) {
    depsPromise = Promise.all([
      import('marked'),
      import('highlight.js/lib/common'),
      loadKatex()
    ]).then(([mm, hm, katex]) => ({
      marked: mm.marked || mm.default || mm,
      hljs: hm.default || hm,
      katex
    })).catch((e) => { depsPromise = null; throw e; }); // 加载失败可重试
  }
  return depsPromise;
}

const MATH_TOKEN = (i) => `@@INKMATH${i}@@`;

/** [toc] 行替换为按层级缩进的超链接列表（与编辑器渲染的目录块一致） */
function replaceToc(md) {
  const lines = String(md).split('\n');
  let fence = null;
  let found = false;
  for (const line of lines) {
    const fm = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) { if (fm && line.trim().startsWith(fence)) fence = null; continue; }
    if (fm) { fence = fm[1]; continue; }
    if (/^\s{0,3}\[toc\]\s*$/i.test(line)) { found = true; break; }
  }
  if (!found) return md;
  const headings = collectHeadings(lines);
  const list = headings.map((h) =>
    '  '.repeat(h.level - 1) + '- [' + h.title.replace(/[\[\]]/g, '') + '](#' + slugify(h.title) + ')'
  ).join('\n');
  fence = null;
  return lines.map((line) => {
    const fm = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) { if (fm && line.trim().startsWith(fence)) fence = null; return line; }
    if (fm) { fence = fm[1]; return line; }
    if (/^\s{0,3}\[toc\]\s*$/i.test(line)) return list;
    return line;
  }).join('\n');
}

/** 预提取脚注：定义行必须先移除——marked 会把 [^x]: text 当作链接引用定义吞掉 */
function extractFootnotes(md) {
  const lines = String(md).split('\n');
  const defs = [];
  const out = [];
  let fence = null;
  for (const line of lines) {
    const fm = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (fence) { out.push(line); if (fm && line.trim().startsWith(fence)) fence = null; continue; }
    if (fm) { fence = fm[1]; out.push(line); continue; }
    const dm = /^\s{0,3}\[\^([^\]\s]+)\]:\s*(.*)$/.exec(line);
    if (dm) { defs.push({ label: dm[1], body: dm[2] }); continue; }
    out.push(line);
  }
  return { md: out.join('\n'), defs };
}

/** 脚注：正文引用替换为上标链接（按定义顺序编号），定义渲染后聚到文末 */
function renderFootnotes(html, defs, marked) {
  if (!defs.length) return html;
  const num = new Map();
  defs.forEach((d, i) => num.set(d.label, i + 1));
  let next = defs.length + 1;
  html = html.replace(/\[\^([^\]\s]+)\]/g, (m, label) => {
    if (!num.has(label)) num.set(label, next++);
    const n = num.get(label);
    return `<sup class="ink-fn-ref"><a href="#fn-${n}">[${n}]</a></sup>`;
  });
  const notes = defs.map((d) =>
    `<p class="ink-fn-note" id="fn-${num.get(d.label)}"><span class="ink-fn-label">[${num.get(d.label)}]</span> ${marked.parse(d.body || '').trim()}</p>`
  );
  return html + `<hr class="ink-fn-rule"><div class="ink-footnotes">${notes.join('\n')}</div>`;
}

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
      const single = /^\s{0,3}\$\$([\s\S]+?)\$\$\s*$/.exec(line);
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

function restoreMath(html, store, katex) {
  let s = html.replace(/<p>\s*@@INKMATH(\d+)@@\s*<\/p>/g, (m, i) => renderTex(store[Number(i)], true, katex));
  s = s.replace(/@@INKMATH(\d+)@@/g, (m, i) => renderTex(store[Number(i)], false, katex));
  return s;
}

function renderTex(item, wrap, katex) {
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
function configureMarked(marked, hljs) {
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
      },
      // 图片：alt 尾部 |400 语法转为显示宽度（与编辑器渲染一致）
      image(hrefOrToken, titleArg, textArg) {
        const isObj = hrefOrToken && typeof hrefOrToken === 'object';
        const href = isObj ? hrefOrToken.href : hrefOrToken;
        const title = isObj ? hrefOrToken.title : titleArg;
        let text = isObj ? (hrefOrToken.text || '') : (textArg || '');
        let width = '';
        const wm = /\|(\d+(?:\.\d+)?)$/.exec(text);
        if (wm) { width = ` style="width:${wm[1]}px"`; text = text.slice(0, text.length - wm[0].length); }
        return `<img src="${escapeHtml(href || '')}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}${width}>`;
      }
    }
  });
}

export async function renderMarkdown(md) {
  const { marked, hljs, katex } = await loadExportDeps();
  configureMarked(marked, hljs);
  const fn = extractFootnotes(replaceToc(md));
  const { text, store } = extractMath(fn.md);
  const html = marked.parse(text);
  return renderFootnotes(restoreMath(html, store, katex), fn.defs, marked);
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
export async function renderMarkdownAsync(md, { theme = 'light' } = {}) {
  const { marked, hljs, katex } = await loadExportDeps();
  configureMarked(marked, hljs);
  const fn = extractFootnotes(replaceToc(md));
  const { text: t1, store: mstore } = extractMath(fn.md);
  const { text: t2, store: mmstore } = extractMermaid(t1);
  const html = marked.parse(t2);
  let s = renderFootnotes(restoreMath(html, mstore, katex), fn.defs, marked);
  for (let i = 0; i < mmstore.length; i++) {
    // 图表配色跟随文档色系，避免暗色文档里嵌入浅色图表
    const svg = await renderMermaid(mmstore[i], theme === 'dark' ? 'dark' : 'light');
    const html = `<div class="mermaid-block">${svg}</div>`;
    // 用函数形式替换：SVG 含 $&、$' 等序列时，字符串替换会破坏输出
    s = s.replace(new RegExp(`<p>\\s*${MERMAID_TOKEN(i)}\\s*<\\/p>`), () => html)
      .replace(new RegExp(MERMAID_TOKEN(i), 'g'), () => html);
  }
  return s;
}

export async function buildStandaloneHtml(md, { title = 'Document', theme = 'light' } = {}) {
  const body = await renderMarkdown(md);
  return wrapHtml(body, { title, theme });
}

/** 异步版：mermaid 块渲染为内联 SVG，其余与 buildStandaloneHtml 一致 */
export async function buildStandaloneHtmlAsync(md, { title = 'Document', theme = 'light' } = {}) {
  const body = await renderMarkdownAsync(md, { theme });
  return wrapHtml(body, { title, theme });
}

/** 剪贴板富文本片段：正文 + KaTeX 样式内联（不含文档外壳），粘进邮件/Word 等保留排版 */
export async function buildRichFragment(md, { theme = 'light' } = {}) {
  const body = await renderMarkdownAsync(md, { theme });
  return `<style>${KATEX_CSS}</style><div class="ink-article">${body}</div>`;
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

/** 桌面版：主进程 printToPDF 直出文件；浏览器版：隐藏 iframe 调打印（选「另存为 PDF」） */
export async function printToPdf(md, { title = 'Document', theme = 'light' } = {}) {
  const dark = theme === 'dark';
  const html = (await buildStandaloneHtmlAsync(md, { title, theme }))
    .replace('</head>', `<style>
@page { margin: 18mm 16mm; }
body { background: ${dark ? '#17181d' : '#fff'} !important; }
.ink-article { max-width: none; padding: 0; }
@media print { a { color: inherit; text-decoration: underline; } pre, table, blockquote, .math-block { break-inside: avoid; } h1,h2,h3 { break-after: avoid; } }
</style></head>`);
  if (isDesktop) {
    const r = await desktopExportPdf(html, title + '.pdf');
    if (r === null) return 'cancelled';
    if (!r || !r.ok) return 'failed:' + (r && r.reason || '未知错误');
    return 'saved';
  }
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
  return 'printed';
}
