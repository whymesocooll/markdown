// README 截图生成器：把 test/fixtures/readme-demo.md 注入编辑器，
// 逐主题截图到 docs/screenshots/。用法：npm run build && node test/make-readme-shots.mjs
// 截图口径：hero 1440x940（侧栏开），画廊 1200x800（侧栏关）；光标统一停在首段行，
// 演示"光标处显示源码、其余位置渲染"的核心机制。
import { launchEdge } from './_edge.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = fs.readFileSync(path.join(root, 'test/fixtures/readme-demo.md'), 'utf8');
const outDir = path.join(root, 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

// 迷你静态服务器：只服务 dist/，端口由系统分配
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, 'dist', p);
  if (!file.startsWith(path.join(root, 'dist')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await launchEdge(['--window-size=1500,1000', '--force-device-scale-factor=2', '--hide-scrollbars']);
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));

  const waitRendered = async () => {
    await page.waitForSelector('.ink-math .katex', { timeout: 20000 });
    await page.waitForSelector('.ink-mermaid svg', { timeout: 20000 });
    await page.waitForSelector('table.ink-table', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 600));
  };

  async function loadDemo() {
    await page.waitForSelector('.cm-content', { timeout: 20000 });
    await page.evaluate((text) => window.InkFlow.loadContent('InkFlow 演示.md', text, null, null), demo);
  }

  // 光标停在首段加粗片段内部：该段露出 ** 源码标记，其余位置保持渲染
  const focusIntro = () => page.evaluate(() => {
    const v = window.InkFlow.app.view;
    const doc = v.state.doc.toString();
    const at = doc.indexOf('所见即所得');
    v.dispatch({ selection: { anchor: at + 3 }, scrollIntoView: false });
    document.querySelector('.editor-wrap')?.scrollTo(0, 0);
  });

  const shoot = async (theme, file, { width = 1200, height = 800, sidebar = false } = {}) => {
    await page.evaluate((t, sb) => {
      const key = 'inkflow:settings';
      let s = {};
      try { s = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { /* 忽略损坏数据 */ }
      s.theme = t; s.sidebar = sb;
      localStorage.setItem(key, JSON.stringify(s));
    }, theme, sidebar);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await loadDemo();
    await focusIntro();
    await waitRendered();
    await page.screenshot({ path: path.join(outDir, file) });
    console.log('SHOT', file);
  };

  // 首次加载建立会话
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: 'networkidle0' });

  // 主视觉：暗色 / 亮色，侧栏开
  await shoot('dark', 'hero-dark.png', { width: 1440, height: 940, sidebar: true });
  await shoot('light', 'hero-light.png', { width: 1440, height: 940, sidebar: true });

  // 主题画廊：侧栏关，统一取景（dark/light 也补一张画廊口径，九套主题排版一致）
  for (const t of ['dark', 'light', 'dracula', 'nord', 'tokyo-night', 'ink-wash', 'carbon-lilac', 'paper-saffron', 'solarized-light']) {
    await shoot(t, `theme-${t}.png`);
  }
  console.log('DONE');
} finally {
  await browser.close().catch(() => {});
  server.close();
}
