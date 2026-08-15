// Mermaid 测试：编辑器内渲染 widget、光标行回源码、导出 HTML 内联 SVG
import { launchEdge } from './_edge.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launchEdge();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });

const MD = [
  '# 图例',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[完成]',
  '  B -->|否| A',
  '```',
  '',
  '```js',
  'const x = 1;',
  '```'
].join('\n');

await page.evaluate((md) => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: md + '\n\n' } });
  v.dispatch({ selection: { anchor: v.state.doc.length } });
}, MD);
await sleep(400);

check('mermaid 块渲染为 widget', await page.$('.ink-mermaid') !== null);

// 等待 mermaid 懒加载 + 渲染完成（首次加载较慢）
let svg = null;
for (let i = 0; i < 40; i++) {
  svg = await page.$('.ink-mermaid.ready svg');
  if (svg) break;
  await sleep(500);
}
check('mermaid 渲染出 SVG', svg !== null);
if (svg) {
  const label = await page.evaluate(() => document.querySelector('.ink-mermaid.ready svg')?.textContent || '');
  check('SVG 含流程图节点文字', label.includes('开始') && label.includes('完成'), label.slice(0, 40));
}

// 光标移到 mermaid 块内部 -> 显示源码
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  const inside = '# 图例\n\n```mermaid\n'.length; // 恰好在 mermaid 块内
  v.dispatch({ selection: { anchor: inside } });
});
await sleep(400);
check('光标行显示 mermaid 源码', await page.evaluate(() => {
  const t = document.querySelector('.cm-content').innerText;
  return t.includes('flowchart LR') && t.includes('A[开始]');
}));

// 移开光标 -> 恢复渲染
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ selection: { anchor: v.state.doc.length } });
});
await sleep(400);
check('移开光标后恢复图表', await page.$('.ink-mermaid.ready svg') !== null);

// 无效图 -> 错误提示
await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '```mermaid\nflowchart 语法错误!!!\n```\n\n' } });
  v.dispatch({ selection: { anchor: v.state.doc.length } });
});
await sleep(600);
for (let i = 0; i < 20; i++) {
  if (await page.$('.ink-mermaid.error')) break;
  await sleep(300);
}
check('语法错误显示错误提示', await page.$('.ink-mermaid.error') !== null);

// 导出 HTML：mermaid 内联为 SVG
const exported = await page.evaluate(async () => {
  const md = '## 图表\n\n```mermaid\nflowchart LR\n  X[入口] --> Y[出口]\n```\n';
  const html = await window.InkFlow.buildStandaloneHtmlAsync(md, { title: 'T', theme: 'light' });
  return { html, hasSvg: html.includes('<svg'), hasBlock: html.includes('mermaid-block'), hasCode: html.includes('flowchart') && !html.includes('```') };
});
check('导出 HTML 内联 SVG', exported.hasSvg && exported.hasBlock, 'svg=' + exported.hasSvg + ' block=' + exported.hasBlock);
check('导出不含 mermaid 源码块', exported.hasCode);

// 无 mermaid 文档的同步导出不受影响（doc-theme.css 里有 .mermaid-block 样式名，不能按字符串判断）
const plain = await page.evaluate(() => window.InkFlow.buildStandaloneHtml('# 标题\n\n正文。'));
check('同步导出仍可用', plain.includes('<h1') && !plain.includes('<svg'));

console.log('\n--- 页面错误 ---');
if (errors.length) errors.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);

process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failed.length || errors.length ? 1 : 0);
