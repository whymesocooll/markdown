// 文件树测试：桩 showDirectoryPicker -> 树渲染 -> 展开子目录 -> 点击文件打开
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

// 桩目录：notes/{a.md, 子目录/{b.md, c.txt}, 其他.pdf}
await page.evaluate(() => {
  const makeDir = (name, obj) => ({
    name, kind: 'directory',
    async *values() {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') yield makeDir(k, v);
        else yield {
          name: k, kind: 'file',
          async getFile() { return new File([String(v)], k, { type: 'text/markdown' }); }
        };
      }
    },
    async getFileHandle(name, opts) {
      if (opts && opts.create) throw new Error('exists');
      return { name, kind: 'file', async getFile() { return new File([''], name); } };
    },
    async requestPermission() { return 'granted'; }
  });
  window.__fakeRoot = makeDir('notes', {
    'a.md': '## 文件 A\n内容 A。',
    '子目录': { 'b.md': '## 文件 B', 'c.txt': '纯文本' },
    '其他.pdf': 'ignore'
  });
  window.showDirectoryPicker = async () => window.__fakeRoot;
});

// 切到「文档」tab
await page.click('.side-tabs button[data-tab="files"]');
await new Promise((r) => setTimeout(r, 200));

check('无文件夹时显示打开按钮', await page.$('.tree-open') !== null);

await page.click('.tree-open');
await new Promise((r) => setTimeout(r, 500));

const topLevel = await page.evaluate(() => ({
  files: Array.from(document.querySelectorAll('.tree-file')).map((x) => x.textContent.trim()),
  dirs: Array.from(document.querySelectorAll('.tree-dir')).map((x) => x.textContent.trim()),
  toolbar: !!document.querySelector('.tree-toolbar'),
  rootLabel: document.querySelector('.tree-root')?.textContent.trim() || ''
}));
check('顶层显示 md 文件（过滤 pdf）', topLevel.files.length === 1 && topLevel.files[0].includes('a.md'), topLevel.files.join(','));
check('顶层显示目录', topLevel.dirs.length === 1 && topLevel.dirs[0].includes('子目录'), topLevel.dirs.join(','));
check('工具栏与根目录名', topLevel.toolbar && topLevel.rootLabel.replace('📁', '').trim() === 'notes', topLevel.rootLabel);

// 展开子目录（懒加载）
await page.click('.tree-dir');
await new Promise((r) => setTimeout(r, 500));
const sub = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.tree-file')).map((x) => x.textContent.trim()));
check('展开后懒加载子目录文件', sub.length === 3 && sub.some((s) => s.includes('b.md')) && sub.some((s) => s.includes('c.txt')), sub.join(','));

// 点击文件打开，当前文件高亮
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('.tree-file')).find((x) => x.textContent.includes('b.md'));
  btn.click();
});
await new Promise((r) => setTimeout(r, 500));
check('点击打开 b.md', await page.evaluate(() => window.InkFlow.app.view.state.doc.toString()) === '## 文件 B');
check('当前文件高亮', await page.evaluate(() =>
  !!document.querySelector('.tree-file.active')?.textContent.includes('b.md')));

// 高亮跟随已打开句柄：渲染后仍指向 b.md
await page.evaluate(() => { window.InkFlow.app.view.dispatch({ changes: { from: 0, to: 0, insert: ' ' } }); });
await new Promise((r) => setTimeout(r, 900)); // autosave 700ms 后会重渲染
check('autosave 重渲染后高亮保持', await page.evaluate(() =>
  !!document.querySelector('.tree-file.active')?.textContent.includes('b.md')));

console.log('\n--- 页面错误 ---');
if (errors.length) errors.forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);

process.on('exit', () => { try { browser.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ } });
process.exit(failed.length || errors.length ? 1 : 0);
