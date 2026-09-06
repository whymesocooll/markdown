// 全场景点击定位验证：数学块(紧邻/空行)、普通段落、表格、mermaid、分隔线、图片
import { launchEdge } from './_edge.mjs';
const browser = await launchEdge();
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'networkidle0' });
await page.waitForSelector('.cm-content', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));

const CASES = {
  A_math_then_text: ['$$\nE = mc^2\n$$\n紧邻公式的段落文字。\n', '紧邻公式的段落文字。'],
  B_math_then_blank: ['$$\nE = mc^2\n$$\n\n公式后有空行的段落文字。\n', '公式后有空行的段落文字。'],
  C_plain: ['普通第一段。\n\n普通第二段。\n', '普通第二段。'],
  D_table: ['| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n\n表格后的段落文字。\n', '表格后的段落文字。'],
  E_mermaid: ['```mermaid\ngraph TD\nA-->B\n```\n\n图表后的段落文字。\n', '图表后的段落文字。'],
  F_hr: ['---\n\n分隔线后的段落文字。\n', '分隔线后的段落文字。'],
};
let failed = 0;
for (const [name, [tail, target]] of Object.entries(CASES)) {
  const DOC = '# 标题\n\n开头段落。\n\n' + tail;
  await page.evaluate((d) => {
    const v = window.InkFlow.app.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: d }, selection: { anchor: 0 } });
  }, DOC);
  await new Promise((r) => setTimeout(r, 700));
  // 数学/mermaid 为按需懒加载：首次渲染完成前布局会变动，必须等 widget 就绪后再测量点击
  if (tail.includes('$$') || /\$\S/.test(tail)) {
    await page.waitForFunction(
      () => ![...document.querySelectorAll('.ink-math')].some((el) => !el.firstChild),
      { timeout: 10000 }
    ).catch(() => {});
  }
  if (tail.includes('mermaid')) {
    await page.waitForSelector('.ink-mermaid.ready', { timeout: 10000 }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 200));
  const out = await page.evaluate((tgt) => {
    const v = window.InkFlow.app.view;
    const doc = v.state.doc;
    const els = [...document.querySelectorAll('.cm-content > *')];
    const line = els.find((el) => el.textContent.includes(tgt));
    const r = line ? line.getBoundingClientRect() : null;
    const model = [];
    for (let i = 1; i <= doc.lines; i++) {
      const c = v.coordsAtPos(doc.line(i).from);
      model.push({ ln: i, top: c ? Math.round(c.top) : null });
    }
    return { rect: r ? { top: r.top, bot: r.bottom } : null, model, docText: doc.toString() };
  }, target);
  console.log(`===== ${name} =====`);
  console.log('  model tops:', out.model.map(m => `${m.ln}:${m.top}`).join(' '));
  const expected = out.docText.split('\n').findIndex(t => t.includes(target)) + 1;
  if (!out.rect) { console.log('  目标行未找到!'); failed++; continue; }
  await page.mouse.click(400, out.rect.top + (out.rect.bot - out.rect.top) / 2);
  await new Promise((r) => setTimeout(r, 250));
  const res = await page.evaluate(() => {
    const v = window.InkFlow.app.view;
    const h = v.state.selection.main.head;
    return v.state.doc.lineAt(h).number;
  });
  const ok = res === expected;
  if (!ok) failed++;
  console.log(`  click "${target}" -> model line ${res} (预期 ${expected}) ${ok ? 'OK' : '**WRONG**'}`);
}
console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
