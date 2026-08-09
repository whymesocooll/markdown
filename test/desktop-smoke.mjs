// Electron 冒烟：启动应用，验证 preload 桥 + 编辑器挂载 + 文件树 IPC 往返
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 临时目录：a.md + sub/b.txt + x.pdf（应被过滤）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-smoke-'));
fs.writeFileSync(path.join(dir, 'a.md'), '# 冒烟\n');
fs.mkdirSync(path.join(dir, 'sub'));
fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'hi');
fs.writeFileSync(path.join(dir, 'x.pdf'), 'not md');

const child = spawn(electronPath, ['.'], {
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
