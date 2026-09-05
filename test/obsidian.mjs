// Obsidian 主题导入测试：
// 1) 纯函数解析（Node 直测 obsidian.js，覆盖嵌套 var/联合选择器/纯变量块）
// 2) 端到端 UI（puppeteer 上传 fixture 文件 -> 注入/切换/持久化/删除）
import { launchEdge } from './_edge.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeCssToBlocks } from '../src/obsidian.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';
const FIXTURE = path.join(root, 'test', 'fixtures', 'sample-theme.css');

const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

/* ---- 1. 纯函数解析 ---- */
const blocks = themeCssToBlocks(fs.readFileSync(FIXTURE, 'utf8'));
check('解析暗色背景（分量池+嵌套 var fallback）', blocks.dark['--bg'] === 'rgb(30, 30, 46)', blocks.dark && blocks.dark['--bg']);
check('解析暗色文字', blocks.dark['--text'] === 'rgb(205, 214, 244)', blocks.dark && blocks.dark['--text']);
check('解析强调色（纯变量块）', blocks.dark['--accent'] === 'rgb(180, 190, 254)', blocks.dark && blocks.dark['--accent']);
check('解析 token（联合选择器）', blocks.dark['--tok-keyword'] === 'rgb(180, 190, 254)', blocks.dark && blocks.dark['--tok-keyword']);
check('解析高亮底色', blocks.dark['--mark-bg'] === 'rgba(243, 139, 168, 0.3)', blocks.dark && blocks.dark['--mark-bg']);
check('解析亮色变体', blocks.light && blocks.light['--bg'] === 'rgb(239, 241, 245)' && blocks.light['--text'] === 'rgb(76, 79, 105)',
  blocks.light && `${blocks.light['--bg']} / ${blocks.light['--text']}`);
check('派生色 accent-soft 生成', blocks.dark['--accent-soft'] === 'color-mix(in srgb, rgb(180, 190, 254) 14%, transparent)',
  blocks.dark && blocks.dark['--accent-soft']);

/* ---- 2. 端到端 UI ---- */
const browser = await launchEdge();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
page.on('pageerror', (e) => check('页面无错误', false, e.message));
await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));

await page.click('#btnSettings');
await new Promise((r) => setTimeout(r, 300));
const input = await page.$('#importThemeFile');
await input.uploadFile(FIXTURE);
await new Promise((r) => setTimeout(r, 1200));
const after = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  obsOpts: [...document.querySelectorAll('#setTheme option')].map((o) => o.value).filter((v) => v.startsWith('obs-')),
  injected: !!document.getElementById('obsidian-theme-css')?.textContent.includes('[data-theme="obs-sample-theme"]'),
  bg: getComputedStyle(document.body).backgroundColor,
  list: document.getElementById('obsThemeList').textContent.includes('sample-theme'),
}));
check('导入后自动应用暗色', after.theme === 'obs-sample-theme' && after.bg === 'rgb(30, 30, 46)', after.theme + ' / ' + after.bg);
check('下拉框出现暗/亮两个变体', after.obsOpts.length === 2 && after.obsOpts[1] === 'obs-sample-theme-light', after.obsOpts.join(','));
check('主题 CSS 已注入', !!after.injected);
check('已导入列表显示', !!after.list);

await page.select('#setTheme', 'obs-sample-theme-light');
await new Promise((r) => setTimeout(r, 400));
const light = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
check('亮色变体切换', light.theme === 'obs-sample-theme-light' && light.bg === 'rgb(239, 241, 245)', light.theme + ' / ' + light.bg);

await page.select('#setTheme', 'obs-sample-theme');
await new Promise((r) => setTimeout(r, 300));
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
const persisted = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  hasCss: !!document.getElementById('obsidian-theme-css')?.textContent.includes('obs-sample-theme'),
}));
check('刷新后持久化（主题+CSS 恢复）', persisted.theme === 'obs-sample-theme' && persisted.hasCss, persisted.theme);

await page.click('#btnSettings');
await new Promise((r) => setTimeout(r, 300));
await page.click('[data-del-obs="0"]');
await new Promise((r) => setTimeout(r, 400));
const del = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  opts: document.querySelectorAll('#setTheme option').length,
  hasCss: !!document.getElementById('obsidian-theme-css')?.textContent.includes('obs-sample-theme'),
}));
check('删除主题并回退暗色', del.theme === 'dark' && del.opts === 10 && !del.hasCss, del.theme + ' / ' + del.opts);

await browser.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
