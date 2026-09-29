// 通用工具函数
export function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    // wait 传函数时每次触发时取值，支持运行时可调的防抖间隔
    t = setTimeout(() => fn(...args), typeof wait === 'function' ? wait() : wait);
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 转义 HTML 属性值（title/data-* 等双引号包裹场景，不转义单引号） */
export function escapeAttr(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 轻量 HTML 净化：用于把渲染结果写入 innerHTML 前过滤掉脚本 / 事件属性 / 危险协议
export function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  const walk = (node) => {
    const kids = Array.from(node.childNodes);
    for (const el of kids) {
      if (el.nodeType === 1) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'style') {
          el.remove();
          continue;
        }
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const val = String(attr.value || '');
          if (name.startsWith('on')) el.removeAttribute(attr.name);
          else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(val)) {
            el.removeAttribute(attr.name);
          }
        }
        walk(el);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

// 中英文之间自动加空格（pangu 简化版）
const CJK = '\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
export function panguSpacing(text) {
  const lines = text.split('\n');
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    // 保护行内代码、链接地址、数学公式
    const holds = [];
    let s = line.replace(/(`[^`]*`|\$[^$]*\$|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/g, (m) => {
      holds.push(m);
      return `\u0000${holds.length - 1}\u0000`;
    });
    s = s.replace(new RegExp(`([${CJK}])([A-Za-z0-9@&=\\[\\$%\\^\\-\\+\\(\\/\\\\])`, 'g'), '$1 $2');
    s = s.replace(new RegExp(`([A-Za-z0-9!;:,\\.\\?\\)\\]\\$%\\^&=\\+\\/\\\\])([${CJK}])`, 'g'), '$1 $2');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => holds[Number(i)]);
    return s.replace(/[ \t]+$/g, '');
  }).join('\n');
}

// 统计：中文按字、英文按词。单趟扫描代替两遍正则 match——大文档上 /g match 会
// 为每个命中分配数组元素，防抖周期内反复执行时 GC 压力明显
export function countWords(text) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  let cjk = 0, latin = 0, inWord = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped.charCodeAt(i);
    if ((c >= 0x2e80 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf)
      || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) {
      cjk++; inWord = false;
    } else if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
      || c === 0x5f || (c >= 0xc0 && c <= 0x24f)) {
      if (!inWord) { latin++; inWord = true; }
    } else {
      inWord = false;
    }
  }
  return { words: cjk + latin, chars: text.length, cjk, latin };
}

export function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-') || 'section';
}

/** 提取 ATX/Setext 标题（[toc] widget 与导出共用），行号为 0-based */
export function collectHeadings(lines) {
  const out = [];
  let fence = null;
  let prevText = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const fm = /^\s{0,3}(```+|~~~+)/.exec(t);
    if (fence) { if (fm && t.trim().startsWith(fence)) { fence = null; prevText = ''; } continue; }
    if (fm) { fence = fm[1]; prevText = ''; continue; }
    const setext = /^\s{0,3}(=+|-+)\s*$/.exec(t);
    const isAtx = /^#{1,6}\s+/.test(prevText);
    const isList = /^\s*([-*+]|\d+[.)])\s/.test(prevText);
    if (setext && prevText && !isAtx && !isList) {
      out.push({ level: setext[1][0] === '=' ? 1 : 2, title: prevText.replace(/[*_`~]/g, '').trim() || '(空标题)', line: i - 1 });
      prevText = '';
      continue;
    }
    const m = /^(#{1,6})\s+(.*)$/.exec(t);
    if (m) {
      out.push({ level: m[1].length, title: m[2].replace(/[*_`~]/g, '').trim() || '(空标题)', line: i });
      prevText = '';
      continue;
    }
    prevText = t.trim() ? t : '';
  }
  return out;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
