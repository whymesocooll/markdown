// 诊断脚本：抓取页面错误、检查 window.InkFlow、检查 # 标记隐藏
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/index.html';

const errors = [];
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));

await page.goto(URL_, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));

const diag = await page.evaluate(() => {
  const out = { inkflow: typeof window.InkFlow };
  try { out.hasApp = !!window.InkFlow?.app; } catch (e) { out.hasAppErr = String(e); }
  const cm = document.querySelector('.cm-content');
  out.innerTextStart = cm ? cm.innerText.split('\n').slice(0, 6) : null;
  out.hasInkH1 = !!document.querySelector('.ink-h1');
  // 把光标移到文档末尾，检查非光标行的 # 是否隐藏
  try {
    const v = window.InkFlow.app.view;
    const end = v.state.doc.length;
    v.dispatch({ selection: { anchor: end } });
  } catch (e) { out.cursorErr = String(e); }
  return out;
});
await new Promise((r) => setTimeout(r, 400));
const after = await page.evaluate(() => {
  const cm = document.querySelector('.cm-content');
  const t = cm ? cm.innerText : '';
  return { textLines: t.split('\n'), hasHashLine: /^#\s/m.test(t) };
});

console.log('=== DIAG ===');
console.log(JSON.stringify(diag, null, 2));
console.log('--- after moving cursor to end ---');
console.log(JSON.stringify(after, null, 2));
console.log('=== PAGE ERRORS ===');
if (errors.length) errors.slice(0, 10).forEach((e) => console.log(' ! ' + e));
else console.log('（无）');
await browser.close();
