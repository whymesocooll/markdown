// src/theme.js —— 主题与外观：主题循环/色系归属、Obsidian 主题导入注入、外观应用（applyAppearance）
import { EditorView } from '@codemirror/view';
import { spellcheckComp } from './editor.js';
import { refreshEffect } from './livepreview.js';
import { themeCssToBlocks, blockToCss } from './obsidian.js';
import { settings, saveSettings, app, OBSIDIAN_THEMES_KEY } from './state.js';
import { $, ICON } from './icons.js';
import { escapeAttr } from './utils.js';

/* ---------------- 主题色系 ---------------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
export function effectiveTheme() {
  return settings.theme === 'auto' ? (mq.matches ? 'dark' : 'light') : settings.theme;
}
// 主题展示名（设置面板 / 提示条）
export const THEME_NAMES = {
  dark: '墨夜', light: '素白', dracula: '德古拉', nord: '北极光',
  'tokyo-night': '东京之夜', 'solarized-light': '日光',
  'ink-wash': '墨池青黛', 'paper-saffron': '藏经纸', 'carbon-lilac': '碳素紫晶',
  auto: '跟随系统',
};
// 导出 HTML 只支持暗/亮两套文档样式，新主题归入所属色系
export function themeFamily(t) {
  if (t && t.startsWith('obs-')) return t.endsWith('-light') ? 'light' : 'dark';
  return t === 'light' || t === 'solarized-light' || t === 'paper-saffron' ? 'light' : 'dark';
}

/* ---------------- Obsidian 主题导入 ---------------- */
let obsidianThemes = []; // [{ name, key, dark, light }] —— dark/light 为 InkFlow 变量集或 null
export function loadObsidianThemes() {
  try { obsidianThemes = JSON.parse(localStorage.getItem(OBSIDIAN_THEMES_KEY) || '[]'); } catch (e) { obsidianThemes = []; }
}
function saveObsidianThemes() {
  try { localStorage.setItem(OBSIDIAN_THEMES_KEY, JSON.stringify(obsidianThemes)); } catch (e) { /* ignore */ }
}
export function injectObsidianCss() {
  let st = document.getElementById('obsidian-theme-css');
  if (!st) { st = document.createElement('style'); st.id = 'obsidian-theme-css'; document.head.appendChild(st); }
  st.textContent = obsidianThemes
    .map((t) => blockToCss(t.key, t.dark) + blockToCss(t.key + '-light', t.light))
    .join('\n');
}
export function obsThemeLabel(key) {
  const t = obsidianThemes.find((x) => x.key === key || x.key + '-light' === key);
  if (!t) return null;
  return t.name + (key.endsWith('-light') ? ' · 亮色' : ' · 暗色');
}
export function refreshThemeSelect() {
  const sel = $('#setTheme');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = [
    '<option value="dark">墨夜（暗色）</option>',
    '<option value="dracula">德古拉 Dracula</option>',
    '<option value="nord">北极光 Nord</option>',
    '<option value="tokyo-night">东京之夜 Tokyo Night</option>',
    '<option value="ink-wash">墨池青黛 Ink Wash</option>',
    '<option value="carbon-lilac">碳素紫晶 Carbon Lilac</option>',
    '<option value="paper-saffron">藏经纸 Paper Saffron</option>',
    '<option value="light">素白（亮色）</option>',
    '<option value="solarized-light">日光 Solarized</option>',
    '<option value="auto">跟随系统</option>',
    ...obsidianThemes.map((t) =>
      `<option value="${t.key}">${escapeAttr(t.name)} · 暗色（Obsidian）</option>` +
      (t.light ? `<option value="${t.key}-light">${escapeAttr(t.name)} · 亮色（Obsidian）</option>` : '')),
  ].join('');
  sel.value = cur;
}
export function renderObsidianList() {
  const el = $('#obsThemeList');
  if (!el) return;
  if (!obsidianThemes.length) { el.textContent = '暂无（从 Obsidian 社区下载 theme.css 后导入）'; return; }
  el.innerHTML = obsidianThemes.map((t, i) =>
    `<span class="obs-theme-item">${escapeAttr(t.name)}<button class="btn ghost" data-del-obs="${i}" title="删除" style="height:22px;padding:0 8px;margin-left:4px">✕</button></span>`).join(' ');
}
export async function importObsidianTheme(file) {
  const css = await file.text();
  const blocks = themeCssToBlocks(css);
  if (!blocks.dark && !blocks.light) throw new Error('未找到 Obsidian 主题变量');
  const base = (file.name.replace(/\.css$/i, '').trim() || 'Obsidian');
  const slug = base.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'obsidian';
  let key = 'obs-' + slug, n = 2;
  while (obsidianThemes.some((t) => t.key === key)) key = 'obs-' + slug + '-' + (n++);
  obsidianThemes.push({ name: base, key, dark: blocks.dark || null, light: blocks.light || null });
  saveObsidianThemes();
  injectObsidianCss();
  refreshThemeSelect();
  renderObsidianList();
  settings.theme = blocks.dark ? key : key + '-light';
  saveSettings();
  applyAppearance();
  return base;
}
export function deleteObsidianTheme(i) {
  const t = obsidianThemes[i];
  if (!t) return null;
  obsidianThemes.splice(i, 1);
  saveObsidianThemes();
  injectObsidianCss();
  refreshThemeSelect();
  renderObsidianList();
  return t;
}

let lastSpellcheck = null;
export function applyAppearance() {
  const prevTheme = document.documentElement.dataset.theme;
  const th = effectiveTheme();
  document.documentElement.dataset.theme = th;
  const root = document.documentElement.style;
  root.setProperty('--editor-size', settings.fontSize + 'px');
  root.setProperty('--editor-lh', String(settings.lineHeight));
  root.setProperty('--page-width', settings.pageWidth + 'px');
  root.setProperty('--editor-font',
    settings.fontKind === 'serif' ? 'var(--font-serif)'
      : settings.fontKind === 'mono' ? 'var(--font-mono)' : 'var(--font-ui)');
  const appEl = $('#app');
  appEl.classList.toggle('justify', !!settings.justify);
  appEl.classList.toggle('focus-mode', !!settings.focusMode);
  appEl.classList.toggle('typewriter', !!settings.typewriter);
  appEl.classList.toggle('no-sidebar', !settings.sidebar);
  $('#userCss').textContent = settings.customCss || '';
  $('#btnTheme').innerHTML = th === 'dark' ? ICON.sun : ICON.moon;
  $('#btnFocus').classList.toggle('on', !!settings.focusMode);
  $('#btnTypewriter').classList.toggle('on', !!settings.typewriter);
  $('#btnSidebar').classList.toggle('active', !!settings.sidebar);
  // 仅主题真正变化时刷新装饰（mermaid 等 widget 需要重建换肤）；
  // 字号/行高/页宽走 CSS 变量即可，CM 会自动重测，不必每次滑块拖动都全量重建装饰
  if (app.view && prevTheme !== th) app.view.dispatch({ effects: refreshEffect.of(null) });
  // 拼写检查：仅在开关变化时重配 compartment（editor 初始为关）
  const sp = !!settings.spellcheck;
  if (app.view && sp !== lastSpellcheck) {
    lastSpellcheck = sp;
    app.view.dispatch({ effects: spellcheckComp.reconfigure(
      EditorView.contentAttributes.of({ spellcheck: sp ? 'true' : 'false', autocapitalize: 'off' })
    ) });
  }
}
mq.addEventListener('change', () => { if (settings.theme === 'auto') applyAppearance(); });
