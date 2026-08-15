// 临时备份测试：清理旧会话、排序、删除与写入失败状态
import { launchEdge } from './_edge.mjs';

const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await launchEdge();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.evaluateOnNewDocument(() => {
  localStorage.setItem('inkflow:vault', JSON.stringify([
    { id: 'legacy-a', name: '旧文档.md', text: '旧内容', created: 100, updated: 200 }
  ]));
  localStorage.setItem('inkflow:last', 'legacy-a');
});
await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await page.waitForFunction(() => window.InkFlow && window.InkFlow.F && window.InkFlow.app.view);

const migrated = await page.evaluate(() => ({
  text: window.InkFlow.app.view.state.doc.toString(),
  legacy: localStorage.getItem('inkflow:vault'),
  docs: window.InkFlow.F.listDocs().map((d) => d.id)
}));
check('启动时不恢复上次会话文档', migrated.text !== '旧内容' && !migrated.docs.includes('legacy-a'), JSON.stringify(migrated));
check('迁移后清理旧临时备份', migrated.legacy === null, String(migrated.legacy));

await page.evaluate(async () => {
  await window.InkFlow.F.upsertDoc({ id: 'older', name: '较旧.md', text: 'A' });
  await new Promise((r) => setTimeout(r, 5));
  await window.InkFlow.F.upsertDoc({ id: 'newer', name: '较新.md', text: 'B' });
});
const ids = await page.evaluate(() => window.InkFlow.F.listDocs().map((d) => d.id));
check('文档按最近更新时间排序', ids.indexOf('newer') < ids.indexOf('older'), ids.join(','));

const deleted = await page.evaluate(async () => {
  const r = await window.InkFlow.F.deleteDoc('older');
  return r.ok && !window.InkFlow.F.getDoc('older');
});
check('删除文档同步更新缓存', deleted);

const beforeFailed = await page.evaluate(() => window.InkFlow.F.getDoc(window.InkFlow.app.docId).text);
await page.evaluate(() => {
  window.InkFlow.F.setVaultFailureForTest(new Error('测试写入失败'));
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: v.state.doc.length, insert: '\n未能保存的内容' } });
});
await new Promise((r) => setTimeout(r, 1000));
const failed = await page.evaluate(() => ({
  state: document.querySelector('#saveState').textContent,
  checkpoint: window.InkFlow.app.checkpointState,
  persisted: window.InkFlow.F.getDoc(window.InkFlow.app.docId).text,
  current: window.InkFlow.app.view.state.doc.toString()
}));
check('写入失败不会伪报自动暂存', failed.state === '本地暂存失败' && failed.checkpoint === 'failed', JSON.stringify(failed));
check('写入失败保留最后确认版本', failed.persisted === beforeFailed && failed.current.includes('未能保存的内容'), JSON.stringify(failed));

await page.evaluate(() => window.InkFlow.F.setVaultFailureForTest(null));
await page.evaluate(() => window.InkFlow.app.view.dispatch({ changes: { from: window.InkFlow.app.view.state.doc.length, insert: '，重试成功' } }));
await new Promise((r) => setTimeout(r, 1000));
const retried = await page.evaluate(() => ({
  state: document.querySelector('#saveState').textContent,
  checkpoint: window.InkFlow.app.checkpointState,
  same: window.InkFlow.F.getDoc(window.InkFlow.app.docId).text === window.InkFlow.app.view.state.doc.toString()
}));
check('恢复写入后状态与内容一致', retried.checkpoint === 'saved' && retried.same && retried.state !== '本地暂存失败', JSON.stringify(retried));

const cleared = await page.evaluate(async () => {
  const r = await window.InkFlow.F.clearDocs();
  return r.ok && !window.InkFlow.F.listDocs().length && !window.InkFlow.F.getLastDocId();
});
check('可清空全部临时备份', cleared);

console.log('\n--- 页面错误 ---');
if (errors.length) errors.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} 通过`);
process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failedChecks.length || errors.length ? 1 : 0);
