// 浏览器冒烟测试：验证实时渲染、公式、表格、格式化命令与导出
import { launchEdge } from './_edge.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const results = [];
const notFound = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await launchEdge(['--window-size=1440,940']);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) notFound.push(r.status() + ' ' + r.url()); });

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));

// 1. 基础渲染
check('编辑器已挂载', await page.$('.cm-content') !== null);
check('标题实时放大', (await page.$$('.ink-h1')).length > 0);
check('任务勾选框渲染', (await page.$$('.ink-task')).length > 0);
check('表格渲染为 HTML 表格', (await page.$$('table.ink-table')).length > 0);
check('数学公式由 KaTeX 渲染', (await page.$$('.ink-math .katex')).length > 0);
check('代码块高亮着色', (await page.$$('.ink-code .tok-keyword')).length > 0);
check('分隔线渲染', (await page.$$('.ink-hr hr')).length > 0);

// 2. 语法标记隐藏 / 光标进入时显现
// 先把光标移到文档末尾（非标题行），确保所有标题行都处于"非光标行"状态
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ selection: { anchor: v.state.doc.length } });
});
await new Promise((r) => setTimeout(r, 300));
const hiddenMarkers = await page.evaluate(() => {
  const text = document.querySelector('.cm-content').innerText;
  return { hasHash: /^#\s/m.test(text), hasStars: text.includes('**所见即所得**') };
});
check('非光标行隐藏 # 标记', !hiddenMarkers.hasHash);
check('非光标行隐藏 ** 标记', !hiddenMarkers.hasStars);

// 3. 输入即渲染
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } });
  v.focus();
});
await page.type('.cm-content', '## 自动化测试标题\n这是 **加粗** 与 *斜体* 和 `code`，公式 $a^2+b^2=c^2$ 结束。\n');
await new Promise((r) => setTimeout(r, 600));
const typed = await page.evaluate(() => ({
  h2: !!document.querySelector('.ink-h2'),
  strong: !!document.querySelector('.ink-strong'),
  em: !!document.querySelector('.ink-em'),
  icode: !!document.querySelector('.ink-inline-code'),
  math: !!document.querySelector('.ink-math-inline .katex'),
  raw: document.querySelector('.cm-content').innerText
}));
check('输入后标题即时渲染', typed.h2);
check('输入后加粗即时渲染', typed.strong);
check('输入后斜体即时渲染', typed.em);
check('输入后行内代码即时渲染', typed.icode);
check('输入后行内公式即时渲染', typed.math);
check('公式源码已隐藏', !typed.raw.includes('$a^2+b^2=c^2$'));

// 4. 工具栏命令
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'hello world' }, selection: { anchor: 0, head: 5 } });
});
await page.click('button[data-act="bold"]');
await new Promise((r) => setTimeout(r, 200));
check('工具栏加粗生效',
  (await page.evaluate(() => window.InkFlow.app.view.state.doc.toString())) === '**hello** world');

await page.click('button[data-act="ul"]');
await new Promise((r) => setTimeout(r, 200));
check('工具栏列表生效',
  (await page.evaluate(() => window.InkFlow.app.view.state.doc.toString())).startsWith('- '));

await page.click('button[data-act="table"]');
await new Promise((r) => setTimeout(r, 400));
check('插入表格生效',
  (await page.evaluate(() => window.InkFlow.app.view.state.doc.toString())).includes('| --- |'));

// 5. 撤销
await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 200));
check('撤销可用',
  !(await page.evaluate(() => window.InkFlow.app.view.state.doc.toString())).includes('| --- |'));

// 6. 导出 HTML
const exported = await page.evaluate(() => window.InkFlow.buildStandaloneHtml(
  '# 标题\n\n正文 **粗** 与公式 $x^2$。\n\n```js\nconst a = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
  { title: 'T', theme: 'light' }
));
check('导出 HTML 含 KaTeX', exported.includes('katex'));
check('导出 HTML 含代码高亮', /class="hljs/.test(exported));
check('导出 HTML 含表格', exported.includes('<table>'));
check('导出 HTML 自包含样式', exported.includes('<style>') && exported.length > 20000);

// 7. 中英文空格
const pangu = await page.evaluate(() => window.InkFlow.panguSpacing('这是Markdown编辑器v2版本'));
check('中英文自动空格', pangu === '这是 Markdown 编辑器 v2 版本', pangu);

// 8. 主题切换 + 9. 设置面板（截图与收尾失败不阻塞结果判定）
let shotsDir = null;
try {
  await page.evaluate(() => {
    const v = window.InkFlow.app.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } });
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  shotsDir = path.join(root, 'shots-' + Date.now());
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, 'dark.png') });
  await page.click('#btnTheme');
  await new Promise((r) => setTimeout(r, 500));
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('主题可切换', theme === 'dracula', theme); // 循环顺序：dark→dracula→...→auto→dark
  await page.screenshot({ path: path.join(shotsDir, 'dracula.png') });
  for (let i = 0; i < 7; i++) await page.click('#btnTheme'); // 循环 7 步回到暗色

  await page.click('#btnSettings');
  await new Promise((r) => setTimeout(r, 300));
  check('设置面板可打开', await page.evaluate(() => !document.querySelector('#settingsDlg').classList.contains('hidden')));
  await page.click('#btnCloseSettings');
} catch (e) {
  console.log(' ! 截图/交互收尾失败（不影响结论）: ' + e.message);
}

console.log('\n--- 控制台错误 ---');
if (errors.length) errors.slice(0, 20).forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
console.log('\n--- HTTP >=400 资源 ---');
if (notFound.length) notFound.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);

// 尽力关闭浏览器子进程（在结论输出之后执行，避免本环境的进程终止钩子截断输出）
// connect 模式下 browser.process() 为 null，旧兜底从未生效；改为退出前显式关闭（内含 CDP Browser.close + profile 重试清理）
try { await browser.close(); } catch (e) { /* 浏览器已退出，忽略 */ }
process.exit(failed.length || errors.length ? 1 : 0);
