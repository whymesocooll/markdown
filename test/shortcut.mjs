// 快捷键回归：验证新增的表格/公式块快捷键、以及此前未单独覆盖的全局快捷键
import { launchEdge } from './_edge.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await launchEdge(['--window-size=1440,940']);
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940 });
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); check('页面无错误', false, e.message); });

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1200));

// 助手：设置空文档并聚焦编辑器
async function resetDoc() {
  await page.evaluate(() => {
    const v = window.InkFlow.app.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '' } });
  });
  await page.click('.cm-content');
  await page.evaluate(() => window.InkFlow.app.view.focus());
  await new Promise((r) => setTimeout(r, 120));
}
// 助手：按住多个修饰键按一次键
async function chord(keys, chars) {
  for (const m of ['Control', 'Alt', 'Shift']) {
    if (keys && keys.includes(m)) await page.keyboard.down(m === 'Control' ? 'Control' : m);
  }
  await page.keyboard.press(chars, { delay: 20 });
  for (const m of ['Shift', 'Alt', 'Control']) {
    if (keys && keys.includes(m)) await page.keyboard.up(m);
  }
}
const docText = () => page.evaluate(() => window.InkFlow.app.view.state.doc.toString());

// 1. 加粗（已有，顺带回归）
await resetDoc();
await page.keyboard.type('hello world', { delay: 5 });
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ selection: { anchor: 0, head: 5 } });
});
await chord(['Control'], 'b');
check('Ctrl+B 加粗包裹', (await docText()).startsWith('**hello**'), (await docText()).slice(0, 30));

// 2. 表格快捷准 Ctrl+Alt+T
await resetDoc();
await chord(['Control', 'Alt'], 't');
check('Ctrl+Alt+T 插入表格', (await docText()).includes('| 列 1 |'), (await docText()).slice(0, 40));

// 3. 公式块快捷准 Ctrl+Alt+M
await resetDoc();
await chord(['Control', 'Alt'], 'm');
check('Ctrl+Alt+M 插入公式块', (await docText()).includes('$$'), (await docText()).slice(0, 30));

// 4. 侧栏切换 Ctrl+\
await resetDoc();
const sidebarBefore = await page.evaluate(() => !document.getElementById('app').classList.contains('no-sidebar'));
await chord(['Control'], '\\');
await new Promise((r) => setTimeout(r, 150));
const sidebarAfter = await page.evaluate(() => !document.getElementById('app').classList.contains('no-sidebar'));
check('Ctrl+\\ 切换侧栏', sidebarBefore !== sidebarAfter, `before=${sidebarBefore} after=${sidebarAfter}`);
await chord(['Control'], '\\'); // 切回

// 5. 阅读模式 Ctrl+Alt+R
await resetDoc();
await chord(['Control', 'Alt'], 'r');
await new Promise((r) => setTimeout(r, 150));
check('Ctrl+Alt+R 进入阅读模式', (await page.evaluate(() => window.InkFlow.app.view.state.readOnly)), '');
await chord(['Control', 'Alt'], 'r'); // 退出

// 6. 源码/所见即所得 Ctrl+/
await resetDoc();
await page.keyboard.type('**加粗**', { delay: 5 });
const markHiddenBefore = (await page.evaluate(() => document.querySelector('.ink-strong')?.textContent)) || '';
await page.click('.cm-content');
await page.evaluate(() => window.InkFlow.app.view.focus());
await chord(['Control'], '/');
await new Promise((r) => setTimeout(r, 150));
const sourceShowsMark = await page.evaluate(() => document.querySelector('.ink-strong') === null);
check('Ctrl+/ 源码模式隐藏渲染标记', sourceShowsMark, markHiddenBefore);
await chord(['Control'], '/');

// 汇总
const failed = results.filter((x) => !x).length + errors.length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);