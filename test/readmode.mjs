// 阅读模式回归测试：只读保护、点击不显示源码、高亮保留、退出后恢复编辑
import { launchEdge } from './_edge.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await launchEdge();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1200));

// 准备含标题 / 加粗 / 高亮 / 任务的文档
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '## 标题甲\n\n正文 **加粗乙** 与 ==高亮丙==。\n\n- [ ] 待办事项\n' } });
});
await new Promise((r) => setTimeout(r, 500));

const docText = () => page.evaluate(() => window.InkFlow.app.view.state.doc.toString());

// 1. 进入阅读模式
await page.evaluate(() => window.InkFlow.setReadMode(true));
await new Promise((r) => setTimeout(r, 300));
check('状态栏按钮变为「阅读」',
  await page.evaluate(() => document.querySelector('#btnRead').textContent === '阅读' && document.querySelector('#btnRead').classList.contains('on')));
check('工具栏进入只读态',
  await page.evaluate(() => document.querySelector('#toolbar').classList.contains('readonly')));
check('源码模式按钮被禁用',
  await page.evaluate(() => document.querySelector('#btnSource').disabled === true));

// 2. 阅读模式下键入无效
const before = await docText();
await page.click('.cm-content');
await page.keyboard.type('xxxx');
await new Promise((r) => setTimeout(r, 300));
check('阅读模式下键入不改变内容', (await docText()) === before);

// 3. 点击标题行不显示 Markdown 源码
await page.evaluate(() => {
  const h = document.querySelector('.ink-h2');
  const r = h.getBoundingClientRect();
  window.__clickPt = { x: r.left + 40, y: r.top + r.height / 2 };
});
await page.mouse.click((await page.evaluate(() => window.__clickPt)).x, (await page.evaluate(() => window.__clickPt)).y);
await new Promise((r) => setTimeout(r, 300));
check('点击标题后仍不显示 # 标记',
  await page.evaluate(() => document.querySelectorAll('.ink-hmark').length === 0
    && !document.querySelector('.cm-content').innerText.startsWith('#')));

// 4. 点击加粗文字不显示 ** 标记
await page.evaluate(() => {
  const s = document.querySelector('.ink-strong');
  const r = s.getBoundingClientRect();
  window.__clickPt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click((await page.evaluate(() => window.__clickPt)).x, (await page.evaluate(() => window.__clickPt)).y);
await new Promise((r) => setTimeout(r, 300));
check('点击加粗后仍不显示 ** 标记',
  await page.evaluate(() => !document.querySelector('.cm-content').innerText.includes('**加粗乙**')));

// 5. ==高亮== 渲染保留（仅隐藏 == 标记）
check('阅读模式下高亮背景保留且 == 隐藏',
  await page.evaluate(() => {
    const hl = document.querySelector('.ink-highlight');
    return !!hl && hl.textContent === '高亮丙' && !document.querySelector('.cm-content').innerText.includes('==');
  }));

// 6. 点击任务勾选框不修改内容
await page.click('.ink-task');
await new Promise((r) => setTimeout(r, 300));
check('阅读模式下勾选框点击不修改内容', (await docText()) === before);

// 7. 快捷键格式化无效
await page.evaluate(() => window.InkFlow.app.view.focus());
await page.keyboard.down('Control'); await page.keyboard.press('KeyB'); await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 300));
check('阅读模式下 Ctrl+B 不生效', (await docText()) === before);

// 8. 退出阅读模式：恢复编辑，点击标题重新显示源码
await page.evaluate(() => window.InkFlow.setReadMode(false));
await new Promise((r) => setTimeout(r, 300));
check('退出后状态栏按钮恢复「编辑」',
  await page.evaluate(() => document.querySelector('#btnRead').textContent === '编辑' && !document.querySelector('#btnRead').classList.contains('on')));
await page.click('.cm-content');
await page.keyboard.type('YYY');
await new Promise((r) => setTimeout(r, 300));
check('退出后恢复可编辑', (await docText()) !== before);
// 重新定位标题坐标（前面的点击已覆盖 __clickPt），点击标题行应显示源码 # 标记
await page.evaluate(() => {
  const h = document.querySelector('.ink-h2');
  const r = h.getBoundingClientRect();
  window.__clickPt = { x: r.left + 40, y: r.top + r.height / 2 };
});
await page.mouse.click((await page.evaluate(() => window.__clickPt)).x, (await page.evaluate(() => window.__clickPt)).y);
await new Promise((r) => setTimeout(r, 300));
check('编辑模式下点击标题显示源码标记',
  await page.evaluate(() => document.querySelectorAll('.ink-hmark').length > 0));

console.log('\n--- 控制台错误 ---');
if (errors.length) errors.slice(0, 20).forEach((e) => console.log(' ! ' + e));
else console.log('（无）');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);

process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failed.length || errors.length ? 1 : 0);
