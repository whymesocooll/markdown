// 统一的 Edge 启动：使用独立 user-data-dir，避免与用户已开的 Edge 实例冲突
// （Windows 下 Edge 单实例会把新导航转发给已有实例，导致 puppeteer 导航超时）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function launchEdge(extraArgs = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-edge-'));
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--font-render-hinting=none', '--user-data-dir=' + profile, ...extraArgs]
  });
  // 关闭时清理临时 profile
  const origClose = browser.close.bind(browser);
  browser.close = async () => {
    try { await origClose(); } finally {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  };
  return browser;
}
