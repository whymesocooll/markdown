// 发布拷贝：把 tauri build 产物复制到 release/（绿色单 exe + NSIS 安装包），保持发布目录约定
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, 'src-tauri', 'target', 'release');
const exe = path.join(target, 'inkflow.exe');
const nsisDir = path.join(target, 'bundle', 'nsis');
if (!fs.existsSync(exe)) {
  console.error(`未找到 ${exe}，先运行 tauri build`);
  process.exit(1);
}
// 注意：不用 rmSync 清空（环境安全钩子会拦截回收站操作），直接覆盖写
const outDir = path.join(root, 'release', 'InkFlow-win32-x64');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(exe, path.join(outDir, 'InkFlow.exe'));
let extra = '';
if (fs.existsSync(nsisDir)) {
  for (const f of fs.readdirSync(nsisDir)) {
    if (f.endsWith('.exe')) {
      fs.copyFileSync(path.join(nsisDir, f), path.join(root, 'release', f));
      extra += ` + ${f}`;
    }
  }
}
console.log(`release/ 已更新：InkFlow-win32-x64/InkFlow.exe${extra}`);
