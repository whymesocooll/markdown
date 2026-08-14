// 构建后启动临时静态服务器，串行运行浏览器回归测试
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = process.env.PORT || '8123';
const url = process.env.URL || `http://127.0.0.1:${port}/index.html`;
const tests = ['smoke.mjs', 'tree.mjs', 'table.mjs', 'mermaid.mjs', 'click.mjs', 'obsidian.mjs', 'vault.mjs'];
const server = spawn('python', ['-m', 'http.server', port, '-d', 'dist'], { stdio: 'ignore', shell: process.platform === 'win32' });

function run(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`test/${file}`], {
      stdio: 'inherit', env: { ...process.env, URL: url }, shell: process.platform === 'win32'
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${file} 失败（退出码 ${code}）`)));
  });
}

try {
  await new Promise((resolve) => setTimeout(resolve, 700));
  for (const file of tests) await run(file);
} finally {
  server.kill();
  try { await once(server, 'exit'); } catch (e) { /* 进程已退出 */ }
}
