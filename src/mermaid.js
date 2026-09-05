// Mermaid 懒加载共享模块（编辑器 Widget 与导出共用同一实例）
let promise = null;

export function loadMermaid() {
  if (!promise) {
    promise = import('mermaid').then((m) => {
      const mm = m.default || m;
      mm.initialize({ startOnLoad: false, securityLevel: 'loose', fontFamily: 'inherit' });
      return mm;
    }).catch((e) => { promise = null; throw e; }); // 加载失败可重试
  }
  return promise;
}

export function mermaidTheme() {
  return ['light', 'solarized-light', 'paper-saffron'].includes(document.documentElement.dataset.theme) ? 'light' : 'dark';
}

/** 渲染 mermaid 源码为 SVG 字符串（id 每次唯一，mermaid 不允许重复 id） */
export async function renderMermaid(code, theme) {
  const mm = await loadMermaid();
  // 注意：render 的第三参数是容器 DOM 元素而非 options —— 传对象会被当作容器导致 ownerDocument 为 undefined
  mm.initialize({ theme: theme || mermaidTheme(), startOnLoad: false, securityLevel: 'loose', fontFamily: 'inherit' });
  const id = 'inkm-' + Math.random().toString(36).slice(2, 8);
  const { svg } = await mm.render(id, String(code));
  return svg;
}
