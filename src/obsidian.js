// Obsidian 主题导入：解析 theme.css 的 CSS 变量，映射为 InkFlow 的主题变量
// 输入主题的 .theme-dark / .theme-light 块，输出 InkFlow 的 29 变量集（含派生色）
// 解析与映射均为纯函数，便于 Node 直接单测

// 源变量名（Obsidian 约定）→ InkFlow 变量，按优先级排列
const MAP = {
  '--bg': ['--background-primary', '--bg-base'],
  '--bg-soft': ['--background-primary-alt', '--background-secondary', '--background-primary'],
  '--panel': ['--background-secondary', '--background-primary'],
  '--panel-2': ['--background-secondary-alt', '--background-modifier-border', '--background-secondary'],
  '--border': ['--background-modifier-border', '--border'],
  '--border-soft': ['--background-modifier-border-hover', '--background-modifier-border'],
  '--text': ['--text-normal', '--text-muted', '--text-on-accent'],
  '--text-strong': ['--text-bright', '--text-normal'],
  '--text-dim': ['--text-muted', '--text-faint', '--text-normal'],
  '--text-faint': ['--text-faint', '--text-muted'],
  '--accent': ['--text-accent', '--interactive-accent', '--accent'],
  '--code-bg': ['--code-background', '--background-primary'],
  '--code-border': ['--background-modifier-border', '--code-background'],
  '--mark-bg': ['--text-highlight-bg', '--background-modifier-hover', '--color-yellow'],
  '--quote-bar': ['--text-muted', '--background-modifier-border'],
  '--inline-code': ['--code-normal', '--text-normal', '--color-red'],
  '--tok-keyword': ['--color-keyword', '--color-purple', '--color-cyan', '--color-blue'],
  '--tok-string': ['--color-string', '--color-green', '--color-cyan'],
  '--tok-number': ['--color-number', '--color-yellow', '--color-orange'],
  '--tok-comment': ['--color-comment', '--text-faint', '--text-muted'],
  '--tok-func': ['--color-function', '--color-blue', '--color-cyan'],
  '--tok-type': ['--color-type', '--color-yellow', '--color-orange'],
  '--tok-prop': ['--color-property', '--color-cyan', '--color-blue'],
  '--tok-var': ['--color-variable', '--text-normal'],
  '--tok-op': ['--color-operator', '--color-blue', '--color-purple'],
  '--tok-punct': ['--text-faint', '--text-muted'],
  '--tok-meta': ['--color-meta', '--color-purple', '--color-pink'],
  '--tok-tag': ['--color-tag', '--color-red', '--color-orange'],
};

const DEFAULTS = {
  '--bg': '#17181c', '--bg-soft': '#1c1e23', '--panel': '#1f2126', '--panel-2': '#24262c',
  '--border': '#2c2f36', '--border-soft': '#24262c', '--text': '#d7dae0', '--text-strong': '#f2f4f8',
  '--text-dim': '#878d99', '--text-faint': '#5b616d', '--accent': '#61a0ff',
  '--code-bg': '#1e2026', '--code-border': '#2b2e36', '--quote-bar': '#3a4150',
  '--inline-code': '#e06c75',
  '--tok-keyword': '#c792ea', '--tok-string': '#a5d6a7', '--tok-number': '#f7a35c',
  '--tok-comment': '#6b7280', '--tok-func': '#82aaff', '--tok-type': '#ffcb6b',
  '--tok-prop': '#89ddff', '--tok-var': '#d7dae0', '--tok-op': '#89ddff',
  '--tok-punct': '#8b90a0', '--tok-meta': '#b39ddb', '--tok-tag': '#f07178',
};

// 平衡大括号切块：返回 [{ sel, inner }]
function splitBlocks(css) {
  const blocks = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < n && depth > 0) {
      const ch = css[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    if (depth === 0) blocks.push({ sel, inner: css.slice(open + 1, j - 1) });
    i = j;
  }
  return blocks;
}

// 多轮迭代展开 var(--x) 引用（支持嵌套 fallback，如 var(--a, var(--b, 1, 2, 3))）
function expandAll(pool) {
  for (let round = 0; round < 10; round++) {
    let changed = false;
    for (const k of Object.keys(pool)) {
      if (!pool[k].includes('var(')) continue;
      const next = pool[k].replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fallback) => {
        const hit = pool[name];
        return hit != null && hit !== '' ? hit : (fallback != null ? fallback.trim() : m);
      });
      if (next !== pool[k]) { pool[k] = next; changed = true; }
    }
    if (!changed) break;
  }
  for (const k of Object.keys(pool)) pool[k] = pool[k].replace(/\s+/g, ' ').trim(); // 压缩多行值（hsl(...) 换行等）
  return pool;
}

// 块内是否全部为变量声明（纯变量块才收进通用池，避免样式块污染）
function isPureVarsBlock(inner) {
  return inner.split(';').map((s) => s.trim()).filter(Boolean)
    .every((s) => /^--[\w-]+\s*:/.test(s));
}

// 从主题 CSS 提取变量：.theme-dark / .theme-light / :root / body / 纯变量块的声明
// 返回 { dark, light }（各为一个变量池；通用块变量进两个池）
export function parseThemeBlocks(css) {
  const out = { dark: null, light: null };
  const body = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ''); // 去注释
  for (const { sel, inner } of splitBlocks(body)) {
    const isDark = sel.includes('theme-dark');
    const isLight = sel.includes('theme-light');
    const pure = isPureVarsBlock(inner);
    if (!isDark && !isLight && !pure) continue; // 只收主题变量块 + 纯变量块
    const targets = [];
    if (isDark) targets.push('dark');
    if (isLight) targets.push('light');
    if (!targets.length) targets.push('dark', 'light'); // 联合选择器（.theme-dark, .theme-light {}）与通用块进两个池
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(inner))) {
      const key = d[1];
      const val = d[2].trim();
      const known = MAP_VALUES.has(key) || key.startsWith('--color-') || key.startsWith('--ctp-') || key.startsWith('--base-');
      for (const t of targets) {
        if (!out[t]) out[t] = {};
        if (!(key in out[t])) out[t][key] = val; // 首次声明优先（块内重复少见）
        if (known) out[t].__known = true;
      }
    }
  }
  for (const t of ['dark', 'light']) {
    if (out[t]) {
      const known = out[t].__known;
      delete out[t].__known;
      if (!known) out[t] = null; // 无主题变量的块不算数
      else expandAll(out[t]);
    }
  }
  return out;
}

const MAP_VALUES = new Set(Object.values(MAP).flat());

// 变量集 → InkFlow 变量（含派生色）；缺省值回退到内置暗色
export function mapTheme(vars) {
  const pick = (keys) => {
    for (const k of keys) {
      const v = vars && vars[k];
      // 残留 var() 的引用（如依赖未定义 toggle 变量的值）视为无效，用下一个候选
      if (v && !v.includes('var(') && v !== 'transparent' && v !== 'inherit' && v !== 'unset') return v;
    }
    return null;
  };
  const out = {};
  for (const [target, sources] of Object.entries(MAP)) out[target] = pick(sources) || DEFAULTS[target] || null;
  const accent = out['--accent'] || DEFAULTS['--accent'];
  // 派生色：半透明强调色（Chromium 111+ 支持 color-mix）
  out['--accent-soft'] = `color-mix(in srgb, ${accent} 14%, transparent)`;
  out['--sel'] = `color-mix(in srgb, ${accent} 25%, transparent)`;
  if (!out['--mark-bg']) out['--mark-bg'] = `color-mix(in srgb, ${accent} 22%, transparent)`;
  const isDark = luminance(accent) < 0.4;
  out['--shadow'] = isDark ? '0 12px 36px rgba(0,0,0,.5)' : '0 12px 32px rgba(15,20,30,.16)';
  return out;
}

// 粗略亮度（hex/rgb 均可）——用于派生阴影深浅
function luminance(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }
  return 0.5;
}

/** 完整流程：theme.css → { dark, light }（各为一组 InkFlow 变量） */
export function themeCssToBlocks(css) {
  const blocks = parseThemeBlocks(css);
  const out = {};
  if (blocks.dark) out.dark = mapTheme(blocks.dark);
  if (blocks.light) out.light = mapTheme(blocks.light);
  return out;
}

/** 变量集 → [data-theme="key"] CSS 文本 */
export function blockToCss(key, vars) {
  if (!vars) return '';
  const body = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join('\n  ');
  return `[data-theme="${key}"] {\n  ${body}\n}\n`;
}
