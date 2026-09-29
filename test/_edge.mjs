// 统一的 Edge 启动：使用独立 user-data-dir，避免与用户已开的 Edge 实例冲突
// （Windows 下 Edge 单实例会把新导航转发给已有实例，导致 puppeteer 导航超时）
//
// Edge 155 起，被 spawn 的初始 msedge.exe 进程会立即退出（退出码 0），真正的浏览器进程
// 作为分离子进程继续运行，DevTools 端口正常可用。puppeteer.launch 等待初始进程存活，
// 会误判为「Failed to launch the browser process: Code: 0」。
// 因此改为：自行拉起浏览器 → 轮询 user-data-dir 下的 DevToolsActivePort 文件 → puppeteer.connect。
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launchEdge(extraArgs = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-edge-'));
  // 自愈清扫：上次运行若因进程退出延迟导致 profile 删除失败，这里把陈旧目录（>30 分钟）顺手清掉。
  // 只清超过时长的目录，避免误删并行测试正在使用的 profile
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (!d.startsWith('inkflow-edge-')) continue;
      const full = path.join(os.tmpdir(), d);
      if (Date.now() - fs.statSync(full).mtimeMs > 30 * 60 * 1000) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch (e) { /* 清扫失败不影响启动 */ }
  const args = [
    '--headless=new',
    '--remote-debugging-port=0', // 端口由浏览器自选并写入 DevToolsActivePort，避免固定端口冲突
    '--no-sandbox',
    '--font-render-hinting=none',
    '--user-data-dir=' + profile,
    ...extraArgs
  ];
  spawn(EDGE, args, { stdio: 'ignore' });

  // DevToolsActivePort 首行是端口、次行是 ws 路径，浏览器就绪后写入；轮询至多 15s
  const portFile = path.join(profile, 'DevToolsActivePort');
  let wsEndpoint = null;
  for (let i = 0; i < 150 && !wsEndpoint; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
      if (port && wsPath) wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;
    } catch (e) { /* 文件尚未出现，继续等 */ }
  }
  if (!wsEndpoint) {
    // 失败路径同样清理 profile——此前每次启动失败都会在 TEMP 漏掉一个目录（浏览器进程可能还活着）
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    throw new Error('Edge DevTools 端口未就绪（DevToolsActivePort 15s 内未出现）');
  }

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
    defaultViewport: { width: 800, height: 600 } // 与 puppeteer.launch 默认视口一致
  });
  // 关闭时清理临时 profile。两个坑（此前曾因此向 TEMP 泄漏大量孤儿进程与 profile 目录）：
  // 1) connect 模式下 browser.close() 只断开连接、不结束浏览器进程 —— 必须先经 CDP 显式 Browser.close；
  // 2) Windows 下浏览器进程完全退出、文件句柄释放有延迟 —— 删除需等断开并重试。
  const origClose = browser.close.bind(browser);
  browser.close = async () => {
    try {
      try {
        const session = await browser.target().createCDPSession();
        await session.send('Browser.close');
        session.detach().catch(() => {});
      } catch (e) { /* 浏览器已退出等情况，忽略 */ }
      try { await origClose(); } catch (e) { /* ignore */ }
      await Promise.race([
        new Promise((r) => browser.once('disconnected', r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    } finally {
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(profile, { recursive: true, force: true }); break; }
        catch (e) { await new Promise((r) => setTimeout(r, 500)); }
      }
    }
  };
  return browser;
}
