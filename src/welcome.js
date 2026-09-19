// 启动欢迎页：全屏烟花粒子特效 + 品牌语。点击任意处 / 任意键 / 「开始写作」进入编辑器。
// 自动化测试（webdriver）下由调用方跳过；prefers-reduced-motion 下只显示静态文字。

function reduceMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let closeFn = null;

/** 显示欢迎页；返回是否真的显示了（已在显示中返回 false） */
export function showWelcome({ onEnter } = {}) {
  const host = document.getElementById('welcome');
  if (!host || !host.classList.contains('hidden')) return false;
  host.classList.remove('hidden');

  let closed = false;
  let stopFx = null;
  if (!reduceMotion()) stopFx = startFireworks(host.querySelector('canvas'), host);

  const enter = () => {
    if (closed) return;
    closed = true;
    if (stopFx) { stopFx(); stopFx = null; }
    window.removeEventListener('keydown', onKey, true);
    host.classList.add('leave');
    setTimeout(() => { host.classList.add('hidden'); host.classList.remove('leave'); }, 450);
    if (onEnter) onEnter();
  };
  // 任意键进入：capture + preventDefault，避免这次按键落进编辑器打出字符
  const onKey = (e) => { e.preventDefault(); e.stopPropagation(); enter(); };
  window.addEventListener('keydown', onKey, true);
  host.addEventListener('pointerdown', (e) => { e.preventDefault(); enter(); }); // preventDefault 阻止默认聚焦，保证 onEnter 能把焦点交给编辑器
  closeFn = enter;
  return true;
}

/** 关闭欢迎页（打包产物截图、外部打开文件前调用）；未显示时为 no-op */
export function dismissWelcome() {
  if (closeFn) closeFn();
}

/* ---------------- 烟花粒子引擎（canvas 2D） ---------------- */
// 半透明清屏产生拖尾，lighter 混合产生光感；粒子总量与单帧成本有上限，关闭即停帧零开销
function startFireworks(canvas, host) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const HUES = [42, 190, 330, 275, 160, 15]; // 金 / 青 / 品红 / 紫 / 翠 / 橙
  const parts = [];
  const rockets = [];
  let nextLaunch = 0;
  const MAX_PARTS = 900;

  const spawn = (now) => {
    rockets.push({
      x: W * (0.12 + Math.random() * 0.76), y: H + 8,
      vx: (Math.random() - 0.5) * 1.4,
      vy: -(H * 0.012 + Math.random() * H * 0.005),
      ty: H * (0.1 + Math.random() * 0.35),
      hue: HUES[(Math.random() * HUES.length) | 0],
    });
  };

  const explode = (r) => {
    const n = 80 + ((Math.random() * 50) | 0);
    const base = Math.random() * Math.PI * 2;
    // 起爆闪光：一个大而快的柔光团，提供"炸开"的瞬间亮度
    parts.push({ x: r.x, y: r.y, vx: 0, vy: 0, life: 1, decay: 0.07, hue: r.hue, r: 16 + Math.random() * 10, tw: false, flash: true });
    for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
      const a = base + (i / n) * Math.PI * 2 + Math.random() * 0.25; // 近似均匀的球形散开
      const sp = (0.3 + Math.random() ** 0.6) * Math.min(W, H) * 0.0075;
      const hot = Math.random() < 0.25; // 白热核心粒子
      parts.push({
        x: r.x, y: r.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 0.008 + Math.random() * 0.012,
        hue: r.hue + (Math.random() * 24 - 12),
        r: 1 + Math.random() * 1.5,
        light: hot ? 92 : 62 + Math.random() * 14,
        tw: !hot && Math.random() < 0.3, // 尾段闪烁
      });
    }
  };

  // 开场：正中先炸一朵，同时三发升空，避免空白等待
  explode({ x: W * 0.5, y: H * 0.3, hue: 45 });
  spawn(0); spawn(0); spawn(0);

  let raf = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6, 8, 14, 0.26)'; // 拖尾
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // 齐放：每次 1-2 发升空，保证天上常驻多朵烟花
    if (now >= nextLaunch) {
      spawn(now);
      if (Math.random() < 0.7) spawn(now);
      nextLaunch = now + 320 + Math.random() * 560;
    }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.x += r.vx; r.y += r.vy;
      r.vy += H * 0.00004;
      // 升空尾焰
      parts.push({
        x: r.x + (Math.random() - 0.5) * 2, y: r.y + 4,
        vx: (Math.random() - 0.5) * 0.4, vy: 1 + Math.random(),
        life: 0.5, decay: 0.05, hue: 42, r: 1.1, tw: false, light: 80,
      });
      ctx.beginPath();
      ctx.fillStyle = 'hsl(45, 100%, 80%)';
      ctx.arc(r.x, r.y, 1.8, 0, 6.2832);
      ctx.fill();
      if (r.y <= r.ty || r.vy >= -1) { explode(r); rockets.splice(i, 1); }
    }

    const g = Math.min(W, H) * 0.00016 + 0.01;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.982; p.vy = p.vy * 0.982 + g;
      p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      const a = p.tw && Math.random() < 0.5 ? p.life * 0.4 : p.life;
      ctx.beginPath();
      if (p.flash) {
        ctx.fillStyle = `hsla(${p.hue}, 90%, 84%, ${a * 0.4})`;
        ctx.arc(p.x, p.y, p.r * (1.6 - p.life * 0.6), 0, 6.2832); // 闪光扩散
      } else {
        ctx.fillStyle = `hsla(${p.hue}, 92%, ${p.light}%, ${a})`;
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      }
      ctx.fill();
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
