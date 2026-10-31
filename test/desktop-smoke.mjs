// Tauri 桌面冒烟：启动应用，验证 inkflowDesktop 桥 + 编辑器挂载 + 文件树 IPC 往返 + 启动参数打开文件
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exe = process.env.INKFLOW_TAURI_EXE
  || path.join(root, 'src-tauri', 'target', 'debug', 'inkflow.exe');
if (!fs.existsSync(exe)) {
  console.error(`desktop smoke: FAIL (找不到 ${exe}，先运行 cargo build --manifest-path src-tauri/Cargo.toml)`);
  process.exit(1);
}

// 临时目录：a.md + sub/b.txt + x.pdf（应被过滤）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-smoke-'));
fs.writeFileSync(path.join(dir, 'a.md'), '# 冒烟\n');
fs.mkdirSync(path.join(dir, 'sub'));
fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'hi');
fs.writeFileSync(path.join(dir, 'x.pdf'), 'not md');

// 同时把 a.md 作为启动参数传入，验证「右键打开方式」链路（argv → 渲染进程打开）
const child = spawn(exe, [path.join(dir, 'a.md')], {
  cwd: root,
  env: { ...process.env, INKFLOW_SMOKE: '1', INKFLOW_SMOKE_DIR: dir },
  stdio: ['ignore', 'pipe', 'pipe']
});
let out = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => process.stderr.write(d));
const code = await new Promise((res) => {
  child.on('close', res);
  setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 60000);
});

const pass = out.includes('SMOKE_RESULT PASS') && code === 0;
console.log(`desktop smoke: ${pass ? 'PASS' : 'FAIL'} (exit=${code})`);
if (!pass && out) console.log(out);
process.exit(pass ? 0 : 1);
