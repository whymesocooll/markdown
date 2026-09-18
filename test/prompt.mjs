// 新建文件输入对话框回归：点击树「＋」弹出对话框（Electron 无 window.prompt 的替代）
// -> 确定创建并出现在树中 -> 重名拦截 -> Escape 取消 -> Enter 确认
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { launchEdge } from './_edge.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 经 run.mjs 运行时复用其静态服务器（URL 环境变量）；独立运行（node test/prompt.mjs）时自带一个
const URL_ = process.env.URL || '';
let server = null;
if (!URL_) {
  server = createServer(async (req, res) => {
    try {
      const p = path.join(root, 'dist', new URL(req.url || '/', 'http://x').pathname === '/' ? 'index.html' : decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const data = await readFile(p);
      const ext = path.extname(p);
      res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream' });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(8123, '127.0.0.1', r));
}
const url = URL_ || 'http://127.0.0.1:8123/index.html';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await launchEdge();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });

// 桩目录：真实 FSA 语义（未创建时重名探测应抛 NotFoundError）
await page.evaluate(() => {
  const files = { 'a.md': '## 文件 A' };
  window.__files = files;
  const root = {
    name: 'notes', kind: 'directory',
    async *values() {
      for (const [k, v] of Object.entries(files)) {
        yield { name: k, kind: 'file', async getFile() { return new File([String(v)], k, { type: 'text/markdown' }); } };
      }
    },
    async getFileHandle(name, opts) {
      const exists = Object.prototype.hasOwnProperty.call(files, name);
      if (!exists && !(opts && opts.create)) {
        const e = new Error('not found'); e.name = 'NotFoundError'; throw e;
      }
      if (opts && opts.create) files[name] = '';
      return { name, kind: 'file', async getFile() { return new File([String(files[name])], name, { type: 'text/markdown' }); } };
    },
    async requestPermission() { return 'granted'; }
  };
  window.showDirectoryPicker = async () => root;
});

// 切到「文档」tab，再打开文件夹
await page.click('.side-tabs button[data-tab="files"]');
await page.waitForSelector('#panelFiles:not(.hidden)', { timeout: 3000 });
await page.click('#panelFiles .tree-open');
await page.waitForSelector('#panelFiles .tree-file', { timeout: 5000 });

// 1. 点击「＋」弹出应用内输入对话框
await page.click('#panelFiles [data-tree="new"]');
await page.waitForSelector('#promptDlg:not(.hidden)', { timeout: 3000 });
check('点击新建弹出输入对话框', await page.evaluate(() => !document.querySelector('#promptDlg').classList.contains('hidden')));
check('输入框已聚焦并全选', await page.evaluate(() => {
  const el = document.querySelector('#promptInput');
  return document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length;
}));

// 2. 输入文件名 → 确定 → 树中出现新文件
await page.evaluate(() => { const el = document.querySelector('#promptInput'); el.value = '新建.md'; });
await page.click('#promptOk');
await page.waitForFunction(() => !document.querySelector('#promptDlg') || document.querySelector('#promptDlg').classList.contains('hidden'), { timeout: 3000 });
await new Promise((r) => setTimeout(r, 300));
const created = await page.evaluate(() => ({
  inTree: !!document.querySelector('#panelFiles [data-open="新建.md"]'),
  stored: Object.keys(window.__files),
  toast: document.querySelector('#toast').textContent
}));
check('确定后创建文件并出现在树中', created.inTree, JSON.stringify(created));

// 3. 重名 → 返回 null → 提示创建失败
await page.click('#panelFiles [data-tree="new"]');
await page.waitForSelector('#promptDlg:not(.hidden)', { timeout: 3000 });
await page.evaluate(() => { const el = document.querySelector('#promptInput'); el.value = 'a.md'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#promptOk');
await new Promise((r) => setTimeout(r, 400));
const dup = await page.evaluate(() => ({
  toast: document.querySelector('#toast').textContent,
  files: Object.keys(window.__files).length
}));
check('重名文件被拦截并提示', dup.toast.includes('创建失败') && dup.files === 2, JSON.stringify(dup));

// 4. Escape 取消
await page.click('#panelFiles [data-tree="new"]');
await page.waitForSelector('#promptDlg:not(.hidden)', { timeout: 3000 });
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 200));
const esc = await page.evaluate(() => ({
  hidden: document.querySelector('#promptDlg').classList.contains('hidden'),
  files: Object.keys(window.__files).length
}));
check('Escape 取消对话框', esc.hidden && esc.files === 2, JSON.stringify(esc));

// 5. 输入框内 Enter 确认
await page.click('#panelFiles [data-tree="new"]');
await page.waitForSelector('#promptDlg:not(.hidden)', { timeout: 3000 });
await page.evaluate(() => { const el = document.querySelector('#promptInput'); el.value = '回车.md'; });
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 400));
const enter = await page.evaluate(() => Object.keys(window.__files));
check('输入框 Enter 确认创建', enter.includes('回车.md'), JSON.stringify(enter));

check('无页面错误', errors.length === 0, errors.join('; '));
await browser.close();
if (server) server.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 通过`);
process.exit(pass === results.length ? 0 : 1);
