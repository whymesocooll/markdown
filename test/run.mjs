// 构建后启动临时静态服务器，串行运行浏览器回归测试
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { extname, resolve, sep } from 'node:path';

const port = process.env.PORT || '8123';
const url = process.env.URL || `http://127.0.0.1:${port}/index.html`;
const tests = ['smoke.mjs', 'tree.mjs', 'prompt.mjs', 'table.mjs', 'mermaid.mjs', 'click.mjs', 'shortcut.mjs', 'obsidian.mjs', 'vault.mjs', 'autosave.mjs', 'readmode.mjs', 'regression.mjs'];
const root = resolve('dist');
const mime = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2'
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = resolve(root, requested);
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
});

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
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  for (const file of tests) await run(file);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}
