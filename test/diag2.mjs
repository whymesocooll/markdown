// 调试：跟踪 bold -> ul -> table 每一步的文档与选区
import { launchEdge } from './_edge.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const browser = await launchEdge(['--disable-gpu', '--disable-dev-shm-usage']);
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1200));

const snap = async (tag) => {
  const s = await page.evaluate(() => {
    const v = window.InkFlow.app.view;
    const st = v.state;
    const r = st.selection.main;
    return { doc: JSON.stringify(st.doc.toString()), sel: [r.from, r.to], head: r.head };
  });
  console.log(tag, 'doc=', s.doc, ' sel=', JSON.stringify(s.sel));
};

await page.evaluate(() => {
  const v = window.InkFlow.app.view;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'hello world' }, selection: { anchor: 0, head: 5 } });
});
await snap('initial  ');

await page.click('button[data-act="bold"]');
await new Promise((r) => setTimeout(r, 250));
await snap('after bold');

await page.click('button[data-act="ul"]');
await new Promise((r) => setTimeout(r, 250));
await snap('after ul  ');

await page.click('button[data-act="table"]');
await new Promise((r) => setTimeout(r, 400));
await snap('after table');

await browser.close();
