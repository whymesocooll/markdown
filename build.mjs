import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (...p) => path.join(root, ...p);
const watch = process.argv.includes('--watch');
// 输出目录可通过环境变量覆盖（默认 dist；当 dist 被外部句柄锁定时可输出到新目录）
const outDir = process.env.OUT_DIR || 'dist';

/* ---------- 生成导出所需的内联样式常量 ---------- */
const katexPkg = JSON.parse(fs.readFileSync(r('node_modules/katex/package.json'), 'utf8'));
const katexCdn = `https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist/`;
const katexCss = fs.readFileSync(r('node_modules/katex/dist/katex.min.css'), 'utf8')
  .replace(/url\((["']?)(fonts\/[^)"']+)\1\)/g, (_m, q, p) => `url(${katexCdn}${p})`);

const pick = (p, fallback = '') => (fs.existsSync(r(p)) ? fs.readFileSync(r(p), 'utf8') : fallback);
const hljsLight = pick('node_modules/highlight.js/styles/github.css');
const hljsDark = pick('node_modules/highlight.js/styles/github-dark.css');
const docCss = fs.readFileSync(r('src/doc-theme.css'), 'utf8');

// 幂等写入：内容一致时跳过（避免与外部文件句柄冲突）
const assetsPath = r('src/gen-assets.js');
const assetsContent =
  '// 由 build.mjs 自动生成，请勿手工修改\n' +
  `export const KATEX_CSS = ${JSON.stringify(katexCss)};\n` +
  `export const HLJS_LIGHT_CSS = ${JSON.stringify(hljsLight)};\n` +
  `export const HLJS_DARK_CSS = ${JSON.stringify(hljsDark)};\n` +
  `export const DOC_CSS = ${JSON.stringify(docCss)};\n`;
try {
  const existing = fs.existsSync(assetsPath) ? fs.readFileSync(assetsPath, 'utf8') : null;
  if (existing !== assetsContent) {
    fs.writeFileSync(assetsPath, assetsContent);
    console.log('gen-assets.js 已更新');
  }
} catch (e) {
  const cur = fs.existsSync(assetsPath) ? fs.readFileSync(assetsPath, 'utf8') : null;
  if (cur === assetsContent) console.log('gen-assets.js 被锁定但内容一致，跳过写入');
  else throw e;
}

/* ---------- 打包 ---------- */
// 注意：不要用 rmSync 清空输出目录（环境安全钩子会拦截回收站操作并抛错），直接覆盖写即可
fs.mkdirSync(r(outDir), { recursive: true });

const options = {
  entryPoints: [r('src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2021'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  outfile: r(`${outDir}/app.js`),
  loader: {
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
    '.svg': 'dataurl',
    '.png': 'dataurl'
  },
  assetNames: 'fonts/[name]',
  legalComments: 'none',
  logLevel: 'info'
};

const copyStatic = () => {
  fs.copyFileSync(r('public/index.html'), r(`${outDir}/index.html`));
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  console.log('watching…');
} else {
  const result = await esbuild.build(options);
  copyStatic();
  const js = fs.statSync(r(`${outDir}/app.js`)).size;
  const css = fs.existsSync(r(`${outDir}/app.css`)) ? fs.statSync(r(`${outDir}/app.css`)).size : 0;
  console.log(`\nbuilt: app.js ${(js / 1024).toFixed(0)} KB, app.css ${(css / 1024).toFixed(0)} KB`);
  if (result.warnings.length) console.log(`${result.warnings.length} warnings`);
}
