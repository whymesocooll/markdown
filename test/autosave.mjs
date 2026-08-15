// 自动保存测试：有文件句柄时回写原文件，无句柄时只暂存，关闭时清理临时备份
import puppeteer from 'puppeteer-core';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none']
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForFunction(() => window.InkFlow && window.InkFlow.app.view);

const saved = await page.evaluate(async () => {
  const { app } = window.InkFlow;
  const writes = [];
  app.handle = {
    name: '自动保存.md',
    createWritable: async () => ({
      write: async (blob) => writes.push(await blob.text()),
      close: async () => {}
    })
  };
  app.savedText = app.view.state.doc.toString();
  app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: '\n自动回写' } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return { writes, dirty: app.dirty, state: document.querySelector('#saveState').textContent };
});
check('有文件句柄时自动回写原文件', saved.writes.length === 1 && saved.writes[0].includes('自动回写'), JSON.stringify(saved));
check('自动回写后清除未保存状态', !saved.dirty && saved.state === '已自动保存到文件', JSON.stringify(saved));

const localOnly = await page.evaluate(async () => {
  const { app, F } = window.InkFlow;
  app.handle = null;
  app.savedText = app.view.state.doc.toString();
  app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: '\n仅本地暂存' } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return {
    dirty: app.dirty,
    state: document.querySelector('#saveState').textContent,
    stored: F.getDoc(app.docId).text
  };
});
check('无文件句柄时仍自动本地暂存', localOnly.dirty && localOnly.state === '已自动暂存' && localOnly.stored.includes('仅本地暂存'), JSON.stringify(localOnly));

const failed = await page.evaluate(async () => {
  const { app, F } = window.InkFlow;
  app.handle = { name: '失败.md', createWritable: async () => { throw new Error('无写入权限'); } };
  app.savedText = app.view.state.doc.toString();
  app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: '\n写入失败' } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return {
    dirty: app.dirty,
    state: document.querySelector('#saveState').textContent,
    stored: F.getDoc(app.docId).text
  };
});
check('自动保存失败时保留未保存状态', failed.dirty && failed.state === '自动保存失败（已本地暂存）' && failed.stored.includes('写入失败'), JSON.stringify(failed));

const closed = await page.evaluate(async () => {
  const { app, F, finishSessionBeforeClose } = window.InkFlow;
  const writes = [];
  app.handle = {
    name: '关闭保存.md',
    createWritable: async () => ({
      write: async (blob) => writes.push(await blob.text()),
      close: async () => {}
    })
  };
  const ok = await finishSessionBeforeClose();
  return { ok, writes, docs: F.listDocs().length, last: F.getLastDocId() };
});
check('关闭前写回当前文件并清空临时备份', closed.ok && closed.writes.length === 1 && closed.docs === 0 && !closed.last, JSON.stringify(closed));

console.log('\n--- 页面错误 ---');
if (errors.length) errors.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} 通过`);
process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failedChecks.length || errors.length ? 1 : 0);
