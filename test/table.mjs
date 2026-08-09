// 表格编辑测试：单元格内联编辑 + 右键菜单（插行/删列/对齐）
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none']
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });

const TABLE_SRC = [
  '| 功能 | 快捷键 | 说明 |',
  '| --- | :---: | --- |',
  '| 加粗 | Ctrl+B | 选中后按下 |',
  '| 保存 | Ctrl+S | 保存到文件 |'
].join('\n');

// 塞入表格并把光标移到末尾（保证表格不被光标触碰 -> 渲染成 widget）
await page.evaluate((src) => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: src + '\n\n' } });
  v.dispatch({ selection: { anchor: v.state.doc.length } });
}, TABLE_SRC);
await new Promise((r) => setTimeout(r, 500));

check('表格渲染为 widget', await page.$('table.ink-table') !== null);

// 1. 单元格内联编辑：点击第一个数据格 -> textarea -> 输入 -> Enter 提交
await page.click('table.ink-table tbody td:first-child');
await new Promise((r) => setTimeout(r, 300));
check('点击单元格出现编辑器', await page.$('.ink-cell-editor') !== null);

await page.evaluate(() => {
  const b = document.querySelector('.ink-cell-editor');
  b.value = '新值';
});
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 400));
check('Enter 提交写回源码',
  (await page.evaluate(() => window.InkFlow.app.view.state.doc.toString())).includes('| 新值 | Ctrl+B |'));

// 2. 右键菜单：在下方插入行
await page.click('table.ink-table tbody td:first-child', { button: 'right' });
await new Promise((r) => setTimeout(r, 300));
check('右键弹出菜单', await page.$('.ink-table-menu:not(.hidden)') !== null);
await page.click('.ink-table-menu [data-op="row-below"]');
await new Promise((r) => setTimeout(r, 400));
const afterInsert = await page.evaluate(() => window.InkFlow.app.view.state.doc.toString());
check('插入行生效', afterInsert.includes('|  |  |  |') && afterInsert.includes('| 保存 | Ctrl+S |'), 'rows=' + afterInsert.split('\n').length);

// 3. 删除列（右键第一行第二列 -> 删列 -> 整表少一列）
await page.click('table.ink-table tbody td:nth-child(2)', { button: 'right' });
await new Promise((r) => setTimeout(r, 300));
await page.click('.ink-table-menu [data-op="col-del"]');
await new Promise((r) => setTimeout(r, 400));
const afterCol = await page.evaluate(() => window.InkFlow.app.view.state.doc.toString());
check('删除列生效', !afterCol.includes('Ctrl+B') && afterCol.includes('| 功能 | 说明 |'), afterCol.split('\n')[0]);

// 4. 对齐：右键第一列 -> 居中
await page.click('table.ink-table tbody td:first-child', { button: 'right' });
await new Promise((r) => setTimeout(r, 300));
await page.click('.ink-table-menu [data-op="align-center"]');
await new Promise((r) => setTimeout(r, 400));
const afterAlign = await page.evaluate(() => window.InkFlow.app.view.state.doc.toString());
check('列对齐生效', afterAlign.includes(':---:'), afterAlign.split('\n')[1]);

// 5. 删除表格
await page.click('table.ink-table tbody td:first-child', { button: 'right' });
await new Promise((r) => setTimeout(r, 300));
await page.click('.ink-table-menu [data-op="table-del"]');
await new Promise((r) => setTimeout(r, 400));
const afterDel = await page.evaluate(() => window.InkFlow.app.view.state.doc.toString());
check('删除表格生效', !afterDel.includes('|') && afterDel.trim() === '');

console.log('\n--- 页面错误 ---');
if (errors.length) errors.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);

process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failed.length || errors.length ? 1 : 0);
