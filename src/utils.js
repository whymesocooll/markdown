// 通用工具函数
export function debounce(fn, wait = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

// 统计：中文按字、英文按词
export function countWords(text) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ');
  const cjk = (stripped.match(new RegExp(`[${CJK}]`, 'g')) || []).length;
  const latin = (stripped.match(/[A-Za-z0-9_\u00c0-\u024f]+/g) || []).length;
  return { words: cjk + latin, chars: text.length, cjk, latin };
}

export function slugify(s) {
  return String(s).trim().toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-') || 'section';
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
