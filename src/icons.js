// src/icons.js —— DOM 查询工具与 SVG 图标集（工具栏 / 侧栏 / 按钮共用）

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const P = (d) => `<path d="${d}"/>`;
export const svg = (inner, size = 17) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICON = {
  sidebar: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`),
  file: svg(P('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z') + P('M14 3v5h5')),
  folder: svg(P('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')),
  save: svg(P('M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z') + P('M17 21v-8H7v8M7 3v5h8')),
  download: svg(P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4') + P('M7 10l5 5 5-5') + P('M12 15V3')),
  quote: svg(P('M6 17h3l2-4V7H5v6h3zM15 17h3l2-4V7h-6v6h3z')),
  ul: svg(P('M9 6h11M9 12h11M9 18h11') + P('M4.5 6h.01M4.5 12h.01M4.5 18h.01')),
  ol: svg(P('M10 6h10M10 12h10M10 18h11') + P('M4 6h1v4M4 10h2') + P('M4 15h2v1.5H4.5V18H6')),
  task: svg(P('M9 11l2 2 4-4') + `<rect x="3" y="4" width="18" height="16" rx="2"/>`),
  link: svg(P('M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1') + P('M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1')),
  image: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>` + P('M21 16l-5-5-9 9')),
  table: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/>` + P('M3 10h18M9 10v10M15 10v10')),
  hr: svg(P('M3 12h18')),
  code: svg(P('M16 18l6-6-6-6M8 6l-6 6 6 6')),
  codeblock: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/>` + P('M9.5 11l-1.5 1.5L9.5 14M14.5 11l1.5 1.5-1.5 1.5')),
  search: svg(`<circle cx="11" cy="11" r="7"/>` + P('M20 20l-3.5-3.5')),
  undo: svg(P('M3 7v6h6') + P('M3.5 13a9 9 0 1 0 2.6-6.4L3 9.5')),
  redo: svg(P('M21 7v6h-6') + P('M20.5 13a9 9 0 1 1-2.6-6.4L21 9.5')),
  sun: svg(`<circle cx="12" cy="12" r="4"/>` + P('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4')),
  moon: svg(P('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z')),
  settings: svg(P('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5')),
  eye: svg(P('M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z') + `<circle cx="12" cy="12" r="3"/>`),
  book: svg(P('M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z') + P('M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z')),
  focus: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>` + P('M12 2v3M12 19v3M2 12h3M19 12h3')),
  type: svg(P('M4 7V5h16v2M12 5v14M9 19h6')),
  trash: svg(P('M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13'), 14),
  plus: svg(P('M12 5v14M5 12h14'))
};
