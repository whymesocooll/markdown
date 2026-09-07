// 回归测试：标题菜单、块插入换行、widget 点击定位、面板监听器、saveState 重置
import { launchEdge } from './_edge.mjs';

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

// 统计 #panelFiles 上 input 监听器的注册次数（wireEvents 只应注册一次）
await page.evaluateOnNewDocument(() => {
  window.__inputRegs = 0;
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'input' && this && this.id === 'panelFiles') window.__inputRegs++;
    return orig.call(this, type, ...rest);
  };
});

page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); check('页面无错误', false, e.message); });
await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

const setDoc = (text, sel = null) => page.evaluate((t, s) => {
  const v = window.InkFlow.app.view;
  if (t !== null) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  if (s) v.dispatch({ selection: s });
  v.focus();
}, text, sel);
const docText = () => page.evaluate(() => window.InkFlow.app.view.state.doc.toString());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 工具栏标题菜单可打开、可选择级别 ---------- */
await page.click('#toolbar button[data-act="heading"]');
await wait(120);
check('标题菜单点击后保持打开',
  await page.evaluate(() => !document.querySelector('#headingMenu').classList.contains('hidden')));
await page.click('#headingMenu button[data-level="2"]');
await wait(150);
check('标题菜单选择级别生效', (await docText()).startsWith('## '),
  (await docText()).split('\n')[0]);
check('选择后菜单关闭',
  await page.evaluate(() => document.querySelector('#headingMenu').classList.contains('hidden')));

/* ---------- 2. 非空行插入代码块/公式块与正文隔离 ---------- */
await setDoc('hello world', { anchor: 0 });
await page.click('#toolbar button[data-act="codeblock"]');
await wait(150);
check('行首插入代码块不粘连', (await docText()) === '```\n\n```\nhello world', JSON.stringify(await docText()));

await setDoc('hello world', { anchor: 5 });
await page.click('#toolbar button[data-act="codeblock"]');
await wait(150);
check('行中插入代码块不粘连', (await docText()) === 'hello\n```\n\n```\n world', JSON.stringify(await docText()));

await setDoc('', { anchor: 0 });
await page.click('#toolbar button[data-act="codeblock"]');
await wait(150);
check('空行插入代码块不受影响', (await docText()) === '```\n\n```', JSON.stringify(await docText()));

await setDoc('hello world', { anchor: 0 });
await page.click('#toolbar button[data-act="mathblock"]');
await wait(150);
check('行首插入公式块不粘连', (await docText()) === '$$\n\n$$\nhello world', JSON.stringify(await docText()));

/* ---------- 3. 上方编辑后点击 widget 仍回到正确源码位置 ---------- */
const clickHr = () => page.evaluate(() => {
  const el = document.querySelector('.ink-hr');
  if (!el) return null;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }));
  return window.InkFlow.app.view.state.selection.main.head;
});
await setDoc('abcd\n\n---\n\nafter', { anchor: 0 });
await wait(200);
const hrPos1 = await clickHr();
check('首次点击分隔线回到源码位置', hrPos1 === 6, 'head=' + hrPos1);
await setDoc(null, { anchor: 0 }); // 光标离开分隔线行，让 widget 重新出现
await wait(250);
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: 0, insert: 'XY' }, selection: { anchor: 0 } });
});
await wait(250);
const hrPos2 = await clickHr();
check('上方编辑后点击分隔线位置随文档偏移', hrPos2 === 8, 'head=' + hrPos2);

const clickMath = () => page.evaluate(() => {
  const el = document.querySelector('.ink-math-inline');
  if (!el) return null;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, cancelable: true }));
  return window.InkFlow.app.view.state.selection.main.head;
});
await setDoc('ab\n\n$x+y$\n\ntail', { anchor: 0 });
await wait(400);
const mPos1 = await clickMath();
check('首次点击行内公式回到源码位置', mPos1 === 4, 'head=' + mPos1);
await setDoc(null, { anchor: 0 });
await wait(250);
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: 0, insert: 'ZZZ' }, selection: { anchor: 0 } });
});
await wait(250);
const mPos2 = await clickMath();
check('上方编辑后点击行内公式位置随文档偏移', mPos2 === 7, 'head=' + mPos2);

/* ---------- 4. #panelFiles 的 input 监听器只注册一次 ---------- */
await page.click('.side-tabs button[data-tab="files"]');
await wait(100);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    document.querySelector('#panelFiles')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(80);
}
const regs = await page.evaluate(() => window.__inputRegs);
check('多次点击面板后 input 监听器不增殖', regs === 1, `注册 ${regs} 次`);

/* ---------- 5. 打开新文档重置 saveState（冲突状态不残留） ---------- */
const st = await page.evaluate(async () => {
  window.InkFlow.app.saveState = 'conflict'; // 模拟上一文档的冲突残留
  await window.InkFlow.loadContent('回归.md', '内容', null, null);
  return { state: window.InkFlow.app.saveState, name: window.InkFlow.app.name };
});
check('loadContent 重置 saveState', st.state === 'idle' && st.name === '回归.md',
  JSON.stringify(st));

/* ---------- 汇总 ---------- */
const failed = results.filter((x) => !x).length + errors.length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
