// src/state.js —— 全局状态唯一归属地：存储 key 常量、设置（含加载校验）、文档会话状态、文件夹树状态
// 本模块不依赖任何其他 src 模块，各模块从这里取共享状态，保证依赖单向

/* ---------------- 本地存储 key 常量（localStorage / IndexedDB 统一登记） ---------------- */
export const SETTINGS_KEY = 'inkflow:settings';               // 外观与行为设置
export const RECENTS_KEY = 'inkflow:recent-files';            // 最近文件（桌面版）
export const OBSIDIAN_THEMES_KEY = 'inkflow:obsidian-themes'; // 导入的 Obsidian 主题
export const VAULT_LIST_KEY = 'inkflow:vault';                // 本地文档库元信息（files.js）
export const LAST_DOC_KEY = 'inkflow:last';                   // 上次打开的文档 id（files.js）
export const VAULT_DB = 'inkflow-vault';                      // 本地文档库 IndexedDB（files.js）
export const FS_DB = 'inkflow-fs';                            // 文件夹句柄持久化 IndexedDB（filetree.js）

/* ---------------- 设置 ---------------- */
export const defaults = {
  theme: 'dark', fontKind: 'sans', fontSize: 16, lineHeight: 1.8,
  pageWidth: 800, justify: false, focusMode: false, typewriter: false,
  sidebar: true, customCss: '', autosaveMs: 700, spellcheck: false, welcome: true
};

// 可静态枚举的主题；obs- 前缀是运行时导入的 Obsidian 主题（theme.js 维护）
const STATIC_THEMES = new Set([
  'dark', 'light', 'dracula', 'nord', 'tokyo-night',
  'ink-wash', 'carbon-lilac', 'paper-saffron', 'solarized-light', 'auto'
]);

// 加载校验：字段类型与默认值不符的直接丢弃；主题名未知回退 dark，防止脏数据破坏启动
function sanitizeSettings(raw) {
  const out = {};
  for (const k of Object.keys(defaults)) {
    const v = raw ? raw[k] : undefined;
    if (typeof v === typeof defaults[k]) out[k] = v;
  }
  if (!STATIC_THEMES.has(out.theme) && !String(out.theme || '').startsWith('obs-')) out.theme = defaults.theme;
  return out;
}

function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; }
}

export const settings = Object.assign({}, defaults, sanitizeSettings(readJSON(SETTINGS_KEY)));

// 恢复默认：原地赋值保持对象身份，导入方始终读到最新字段
export function resetSettings() { Object.assign(settings, defaults); }

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

/* ---------------- 最近文件（桌面版） ---------------- */
const RECENTS_MAX = 10;
export function readRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); } catch (e) { return []; }
}
export function saveRecents(list) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))); } catch (e) { /* ignore */ }
}

/* ---------------- 文档会话状态 ---------------- */
export const app = {
  view: null,
  docId: '',
  name: '未命名.md',
  handle: null,
  dirty: false,
  savedText: '',
  checkpointText: '',
  checkpointState: 'saved',
  checkpointError: null,
  saveSeq: 0,
  closing: false,
  forceClose: false, // 桌面版「不保存关闭」已确认，放行 beforeunload
  sideTab: 'outline',
  mtime: null,
  path: '',
  saveState: 'idle',   // idle|saving-file|saved-file|failed|conflict
  vaultError: false
};

/* ---------------- 文件夹树状态 ---------------- */
export const treeState = {
  nodes: [],      // 顶层节点
  map: new Map(), // path -> 节点（含已懒加载的 children）
  expanded: new Set(), // 已展开的目录 path
  filter: ''      // 文件名搜索关键字（空 = 不过滤）
};
