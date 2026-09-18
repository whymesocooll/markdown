// 极简行内 Markdown 渲染（供表格单元格等 Widget 使用），带行内数学公式
import { loadKatex, katexNow } from './katex-loader.js';
import { escapeHtml } from './utils.js';

export function renderInline(src) {
  let s = String(src == null ? '' : src);
  const holds = [];
  const hold = (html) => {
    holds.push(html);
    return `\u0001${holds.length - 1}\u0001`;
  };

  // 行内代码
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  // 行内公式（KaTeX 未就绪时先显示源码，katexNow 已在后台触发加载）
  s = s.replace(/\$([^$\n]+)\$/g, (m, tex) => {
    const katex = katexNow();
    if (!katex) return hold(escapeHtml(m));
    try {
      return hold(katex.renderToString(tex, { throwOnError: false, strict: 'ignore', output: 'html' }));
    } catch (e) { return hold(escapeHtml(m)); }
  });
  // 图片（alt 尾部 |400 语法指定显示宽度）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) => {
      let w = '';
      const wm = /\|(\d+(?:\.\d+)?)$/.exec(alt);
      if (wm) { w = ` style="width:${wm[1]}px"`; alt = alt.slice(0, alt.length - wm[0].length); }
      return hold(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}${w}>`);
    });
  // 链接
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, text, url, title) => hold(`<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener">${escapeHtml(text)}</a>`));

  s = escapeHtml(s);

  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  // 此时 <br> 已被转义为 &lt;br&gt;：还原为真实换行（与导出 HTML 的行为一致）
  s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');

  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => holds[Number(i)]);
  return s;
}
